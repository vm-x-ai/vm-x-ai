import { getWorkspaces } from '@/clients/api';
import { redirect } from 'next/navigation';

export default async function Page() {
  const workspaces = await getWorkspaces();
  if (!workspaces.data?.length) {
    redirect('/getting-started');
  }
}
