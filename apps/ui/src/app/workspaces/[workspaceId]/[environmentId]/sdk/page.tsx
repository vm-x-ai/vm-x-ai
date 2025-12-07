import SDKDetails from '@/components/SDK/SDKDetails';

type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId } = await params;
  return (
    <SDKDetails
      workspaceId={workspaceId}
      environmentId={environmentId}
      baseUrl={process.env.API_BASE_URL as string}
    />
  );
}
