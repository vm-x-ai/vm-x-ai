import { getUserById } from '@/clients/api';
import { submitForm } from './actions';
import Alert from '@mui/material/Alert';
import EditUserForm from '@/components/Users/Form/Edit';

export const metadata = {
  title: 'VM-X AI Console - Settings - Edit User',
  description: 'VM-X AI Console - Settings - Edit User',
};

export type PageProps = {
  params: Promise<{
    userId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { userId } = await params;
  const user = await getUserById({
    path: {
      userId,
    },
  });

  if (user.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch user: {user.error.errorMessage}
      </Alert>
    );
  }

  return <EditUserForm submitAction={submitForm} user={user.data} />;
}
