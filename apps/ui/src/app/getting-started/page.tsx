import Alert from '@mui/material/Alert';
import Grid from '@mui/material/Grid';
import Step from '@mui/material/Step';
import StepContent from '@mui/material/StepContent';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Typography from '@mui/material/Typography';
import GenerateApiKeyStep from '@/components/GettingStarted/APIKey';
import CreateEnvironmentStep from '@/components/GettingStarted/CreateEnvironment';
import CreateWorkspaceStep from '@/components/GettingStarted/CreateWorkspace';
import AppContainer from '@/components/Layout/Container';
import {
  AiResourceEntity,
  EnvironmentEntity,
  getEnvironments,
  getWorkspaces,
  WorkspaceEntity,
} from '@/clients/api';
import { JSX } from 'react';

type StepperData = {
  workspace?: WorkspaceEntity;
  environment?: EnvironmentEntity;
  resource?: AiResourceEntity;
};

type StepDef = {
  label: string;
  labelOptional?: (data?: StepperData) => JSX.Element;
  description: ((data?: StepperData) => JSX.Element) | JSX.Element;
  component: JSX.Element;
};

const steps: StepDef[] = [
  {
    label: 'Create a new workspace',
    labelOptional: (data) =>
      data?.workspace ? (
        <Typography variant="caption">
          Workspace: <strong>{data.workspace?.name}</strong>
        </Typography>
      ) : (
        <></>
      ),
    description: (
      <>
        <Typography variant="subtitle2" marginTop=".5rem">
          What is a workspace?
        </Typography>
        <Typography variant="body2">
          A workspace is a place where you can create and manage your
          environments. You can create multiple workspaces to separate your
          workloads, resources, usage and etc.
        </Typography>

        <Typography variant="subtitle2" marginTop="1rem">
          What do I need to do?
        </Typography>
        <Typography variant="body2">
          In this step you need to choose a name for your workspace and the
          cloud provider you want to use.
        </Typography>
      </>
    ),
    component: <CreateWorkspaceStep />,
  },
  {
    label: 'Create a new environment',
    labelOptional: (data) =>
      data?.environment ? (
        <Typography variant="caption">
          Environment: <strong>{data.environment?.name}</strong>
        </Typography>
      ) : (
        <></>
      ),
    description: (data) => (
      <>
        <Typography variant="subtitle2" marginTop=".5rem">
          What is a environment?
        </Typography>
        <Typography variant="body2">
          An environment is a place where you can deploy your AI services,
          manage your resources, and etc. You can create multiple environments
          in a workspace to separate your workloads, resources, usage and etc.
        </Typography>

        <Typography variant="subtitle2" marginTop="1rem">
          What do I need to do?
        </Typography>
        <Typography variant="body2">
          In this step you need to choose a name for your environment{' '}
        </Typography>
      </>
    ),
    component: <CreateEnvironmentStep />,
  },
  {
    label: 'Generate your API key',
    description: (
      <>
        <Typography variant="body2">
          🎉 Your workspace has been successfully created. now it&apos;s time to
          generate your API Key to start using VM-X services.
        </Typography>
      </>
    ),
    component: <GenerateApiKeyStep />,
  },
];

type GettingStartedPageProps = {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function GettingStartedPage({
  searchParams,
}: GettingStartedPageProps) {
  const params = await searchParams;
  const data: StepperData = {
    workspace: undefined,
    environment: undefined,
  };

  const { error, data: workspaces } = await getWorkspaces();
  if (error) {
    return (
      <Alert variant="filled" severity="error">
        {error.errorMessage}
      </Alert>
    );
  }

  let activeStep = 0;
  if (params && params['workspaceId']) {
    activeStep = 1;
    const workspaceId = params?.['workspaceId'] as string;
    data.workspace = workspaces.find(
      (item) => item.workspaceId === workspaceId
    );
    const { error, data: environments } = await getEnvironments({
      path: { workspaceId },
    });
    if (error) {
      return (
        <Alert variant="filled" severity="error">
          {error.errorMessage}
        </Alert>
      );
    }

    if (params && params['environmentId']) {
      const environmentId = params?.['environmentId'] as string;
      data.environment = environments.find(
        (item) => item.environmentId === environmentId
      );
      activeStep = 2;
    }
  }

  return (
    <Grid container spacing={3}>
      <Grid size={12}>
        <Grid size={6}>
          <AppContainer>
            <Typography variant="h6">Welcome to VM-X Console</Typography>
            <Typography variant="subtitle1">Let&apos;s get started</Typography>
          </AppContainer>
        </Grid>
      </Grid>
      <Grid size={12}>
        <Grid size={6}>
          <AppContainer>
            <Stepper orientation="vertical" activeStep={activeStep}>
              {steps.map((step, index) => (
                <Step key={step.label}>
                  <StepLabel
                    optional={step.labelOptional && step.labelOptional(data)}
                    slotProps={{
                      stepIcon: {
                        style: {
                          color:
                            index < activeStep
                              ? 'var(--mui-palette-success-main)'
                              : 'var(--mui-palette-primary-main)',
                        },
                      },
                    }}
                  >
                    {step.label}
                  </StepLabel>
                  <StepContent>
                    {typeof step.description === 'function'
                      ? step.description(data)
                      : step.description}
                    {step.component}
                  </StepContent>
                </Step>
              ))}
            </Stepper>
          </AppContainer>
        </Grid>
      </Grid>
    </Grid>
  );
}
