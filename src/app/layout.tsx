import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {title:'提示词强化管理台',description:'模型、系统提示词与评测管理'};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
