import { isAdmin } from '@/server/auth';
import Console from './Console';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  if (!await isAdmin()) return <main className="gate">
    <div className="gate-card">
      <span className="brand-mark" aria-hidden="true">笙</span>
      <h1>无法访问管理台</h1>
      <p>管理台仅允许从本机或已授权的主机访问。</p>
      <p className="gate-hint">如需从其他主机访问，请在服务端环境变量 <code>ADMIN_ALLOWED_HOSTS</code> 中加入该主机名，并通过私有网络或访问网关限制入口。</p>
    </div>
  </main>;
  return <Console/>;
}
