import { redirect } from 'next/navigation';

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
    resourceId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId, resourceId } = await params;
  redirect(
    `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${resourceId}/general`
  );
}
