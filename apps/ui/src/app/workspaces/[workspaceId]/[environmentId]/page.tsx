import { redirect } from 'next/navigation';

type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId } = await params;
  redirect(`/workspaces/${workspaceId}/${environmentId}/ai-connections`);
}
