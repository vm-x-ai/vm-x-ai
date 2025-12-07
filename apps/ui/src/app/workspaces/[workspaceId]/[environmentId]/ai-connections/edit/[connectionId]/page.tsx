import { redirect } from 'next/navigation';

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
    connectionId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId, connectionId } = await params;
  redirect(
    `/workspaces/${workspaceId}/${environmentId}/ai-connections/edit/${connectionId}/general`
  );
}
