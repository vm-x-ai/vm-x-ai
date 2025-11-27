import AuthDetails from '@/components/Auth/AuthDetails';

type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId } = await params;
  return (
    <AuthDetails workspaceId={workspaceId} environmentId={environmentId} />
  );
}
