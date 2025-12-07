import CodeIcon from '@mui/icons-material/Code';
import ElectricalServicesIcon from '@mui/icons-material/ElectricalServices';
import LineAxisIcon from '@mui/icons-material/LineAxis';
import LowPriorityIcon from '@mui/icons-material/LowPriority';
import SecurityIcon from '@mui/icons-material/Security';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import WorkspaceTabs from '@/components/Workspace/Tabs';
import { getEnvironmentById, getWorkspaceById } from '@/clients/api';

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{
    workspaceId: string;
    environmentId: string;
  }>;
};

export default async function Layout({ children, params }: LayoutProps) {
  const { workspaceId, environmentId } = await params;
  const [workspace, environment] = await Promise.all([
    getWorkspaceById({
      path: {
        workspaceId,
      },
    }),
    getEnvironmentById({
      path: {
        workspaceId,
        environmentId,
      },
    }),
  ]);
  if (environment.error) {
    return (
      <Box sx={{ padding: 4 }}>
        <Alert variant="filled" severity="error">
          Failed to load environment details: {environment.error.errorMessage}
        </Alert>
      </Box>
    );
  }

  if (workspace.error) {
    return (
      <Box sx={{ padding: 4 }}>
        <Alert variant="filled" severity="error">
          Failed to load workspace details: {workspace.error.errorMessage}
        </Alert>
      </Box>
    );
  }

  const tabs = [
    {
      path: `/workspaces/${workspaceId}/${environmentId}/ai-connections/overview`,
      value: `/workspaces/${workspaceId}/${environmentId}/ai-connections`,
      name: 'AI Connections',
      icon: <ElectricalServicesIcon />,
    },
    {
      path: `/workspaces/${workspaceId}/${environmentId}/ai-resources/overview`,
      value: `/workspaces/${workspaceId}/${environmentId}/ai-resources`,
      name: 'AI Resources',
      icon: <SmartToyIcon />,
    },
    {
      path: `/workspaces/${workspaceId}/${environmentId}/prioritization`,
      name: 'Prioritization',
      icon: <LowPriorityIcon />,
    },
    {
      path: `/workspaces/${workspaceId}/${environmentId}/security/auth`,
      value: `/workspaces/${workspaceId}/${environmentId}/security`,
      name: 'Security',
      icon: <SecurityIcon />,
    },
    {
      path: `/workspaces/${workspaceId}/${environmentId}/insights`,
      value: `/workspaces/${workspaceId}/${environmentId}/insights`,
      name: 'Insights',
      icon: <LineAxisIcon />,
    },
    {
      path: `/workspaces/${workspaceId}/${environmentId}/sdk`,
      value: `/workspaces/${workspaceId}/${environmentId}/sdk`,
      name: 'SDK',
      icon: <CodeIcon />,
    },
  ];

  return (
    <WorkspaceTabs
      tabs={tabs}
      workspace={workspace.data}
      environment={environment.data}
    >
      {children}
    </WorkspaceTabs>
  );
}
