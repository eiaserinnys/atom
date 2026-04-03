export interface CredentialField {
  key: string;
  label: string;
  hint?: string;
  secret: boolean;
}

export interface UnfurlCredentials {
  [key: string]: string;
}

export interface UnfurlResult {
  text: string;           // MCP 텍스트 덤프 (markdown)
  snapshot: string;       // source_snapshot 저장용 (JSON string)
  unfurlData: Record<string, unknown> | null; // 대시보드 구조화 데이터
}

export interface UnfurlAdapter {
  readonly sourceType: string;
  readonly credentialFields: CredentialField[];
  resolve(ref: string, credentials: UnfurlCredentials): Promise<UnfurlResult>;
}
