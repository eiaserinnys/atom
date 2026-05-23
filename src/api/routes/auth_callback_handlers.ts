import type { FastifyBaseLogger, FastifyReply } from 'fastify';
import { SignJWT } from 'jose';
import type { DatabaseAdapter } from '../../db/adapter.js';
import { isEmailAllowed, type User } from '../../db/queries/users.js';
import {
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  JWT_COOKIE_NAME,
  JWT_EXPIRY_SECONDS,
  SLACK_IDENTITY_URL,
  SLACK_TOKEN_URL,
  getJwtCookieOptions,
  isSlackWorkspaceAllowed,
} from './auth_helpers.js';

export type AuthCallbackDeps = {
  fetch: typeof fetch;
  getDb: () => DatabaseAdapter;
  findUserByEmail: (db: DatabaseAdapter, email: string) => Promise<User | null>;
  insertUser: (
    db: DatabaseAdapter,
    input: { email: string; display_name?: string; role: User['role'] },
  ) => Promise<User>;
};

async function issueJwtAndRedirect(input: {
  reply: FastifyReply;
  frontendUrl: string;
  jwtSecret: Uint8Array;
  dbUser: Pick<User, 'id' | 'role'>;
  email: string;
  name: string;
}) {
  const token = await new SignJWT({
    id: input.dbUser.id,
    email: input.email,
    name: input.name,
    role: input.dbUser.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${JWT_EXPIRY_SECONDS}s`)
    .sign(input.jwtSecret);

  input.reply.setCookie(JWT_COOKIE_NAME, token, getJwtCookieOptions(process.env['NODE_ENV']));

  return input.reply.redirect(input.frontendUrl || '/');
}

export async function handleGoogleCallback(input: {
  deps: AuthCallbackDeps;
  reply: FastifyReply;
  frontendUrl: string;
  jwtSecret: Uint8Array;
  code: string;
  googleClientId: string;
  googleClientSecret: string;
  googleCallbackUrl: string;
  allowedEmail?: string;
}) {
  const tokenRes = await input.deps.fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.googleClientId,
      client_secret: input.googleClientSecret,
      redirect_uri: input.googleCallbackUrl,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    return input.reply.redirect(`${input.frontendUrl}/?auth_error=token_exchange`);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };
  const userRes = await input.deps.fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    return input.reply.redirect(`${input.frontendUrl}/?auth_error=userinfo`);
  }

  const user = (await userRes.json()) as { email: string; name: string };
  const db = input.deps.getDb();
  let dbUser = await input.deps.findUserByEmail(db, user.email);
  if (!dbUser && isEmailAllowed(user.email, input.allowedEmail)) {
    dbUser = await input.deps.insertUser(db, { email: user.email, display_name: user.name, role: 'editor' });
  }
  if (!dbUser) return input.reply.redirect(`${input.frontendUrl}/?auth_error=unauthorized`);
  if (!dbUser.is_active) return input.reply.redirect(`${input.frontendUrl}/?auth_error=deactivated`);

  return issueJwtAndRedirect({
    reply: input.reply,
    frontendUrl: input.frontendUrl,
    jwtSecret: input.jwtSecret,
    dbUser,
    email: user.email,
    name: user.name,
  });
}

export async function handleSlackCallback(input: {
  deps: AuthCallbackDeps;
  log: FastifyBaseLogger;
  reply: FastifyReply;
  frontendUrl: string;
  jwtSecret: Uint8Array;
  code: string;
  slackClientId: string;
  slackClientSecret: string;
  slackCallbackUrl: string;
  slackAllowedTeamId?: string;
}) {
  const tokenRes = await input.deps.fetch(SLACK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.slackClientId,
      client_secret: input.slackClientSecret,
      redirect_uri: input.slackCallbackUrl,
    }),
  });

  if (!tokenRes.ok) {
    input.log.warn('Slack OAuth token exchange failed');
    return input.reply.redirect(`${input.frontendUrl}/?auth_error=token_exchange`);
  }

  const tokenData = (await tokenRes.json()) as {
    ok: boolean;
    error?: string;
    authed_user?: { access_token: string };
  };

  if (!tokenData.ok || !tokenData.authed_user?.access_token) {
    input.log.warn({ error: tokenData.error }, 'Slack OAuth token exchange failed');
    return input.reply.redirect(`${input.frontendUrl}/?auth_error=token_exchange`);
  }

  const identityRes = await input.deps.fetch(SLACK_IDENTITY_URL, {
    headers: { Authorization: `Bearer ${tokenData.authed_user.access_token}` },
  });

  if (!identityRes.ok) {
    input.log.warn('Slack identity fetch failed');
    return input.reply.redirect(`${input.frontendUrl}/?auth_error=userinfo`);
  }

  const identityData = (await identityRes.json()) as {
    ok: boolean;
    error?: string;
    user: { id: string; name: string; email: string; image_512?: string; image_192?: string };
    team: { id: string; name: string };
  };

  if (!identityData.ok) {
    input.log.warn({ error: identityData.error }, 'Slack identity fetch failed');
    return input.reply.redirect(`${input.frontendUrl}/?auth_error=userinfo`);
  }

  if (!isSlackWorkspaceAllowed(identityData.team.id, input.slackAllowedTeamId)) {
    input.log.warn(
      { teamId: identityData.team.id, email: identityData.user.email },
      'Unauthorized Slack workspace access attempt',
    );
    return input.reply.redirect(`${input.frontendUrl}/?auth_error=unauthorized_workspace`);
  }

  const email = identityData.user.email;
  const name = identityData.user.name;
  const db = input.deps.getDb();
  let dbUser = await input.deps.findUserByEmail(db, email);
  if (!dbUser) {
    dbUser = await input.deps.insertUser(db, { email, display_name: name, role: 'editor' });
    input.log.info({ email, name }, 'Auto-created user from Slack OAuth');
  }
  if (!dbUser.is_active) return input.reply.redirect(`${input.frontendUrl}/?auth_error=deactivated`);

  return issueJwtAndRedirect({
    reply: input.reply,
    frontendUrl: input.frontendUrl,
    jwtSecret: input.jwtSecret,
    dbUser,
    email,
    name,
  });
}
