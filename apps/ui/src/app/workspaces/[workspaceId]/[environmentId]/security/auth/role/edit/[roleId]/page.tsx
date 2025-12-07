import { redirect } from 'next/navigation';

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
    roleId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId, roleId } = await params;
  redirect(
    `/workspaces/${workspaceId}/${environmentId}/security/auth/role/edit/${roleId}/general`
  );
}
