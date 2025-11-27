import { redirect } from 'next/navigation';

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
    resourceName: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId, resourceName } = await params;
  redirect(
    `/${workspaceId}/${environmentId}/ai-resources/edit/${resourceName}/general`
  );
}
