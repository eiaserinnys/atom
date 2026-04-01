import styles from './LoginPage.module.css';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export function LoginPage() {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>atom</h1>
        <p className={styles.subtitle}>지식 관리 시스템</p>
        <a href={`${BASE_URL}/api/auth/google`} className={styles.button}>
          Google로 로그인
        </a>
      </div>
    </div>
  );
}
