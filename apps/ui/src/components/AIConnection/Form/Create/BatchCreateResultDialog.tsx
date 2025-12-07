import {
  AiConnectionEntity,
  AiProviderDto,
  AiResourceEntity,
} from '@/clients/api';
import { ApiResponse } from '@/clients/types';
import Chat from '@/components/Chat/Chat';
import SDKDetails from '@/components/SDK/SDKDetails';
import TabContext from '@mui/lab/TabContext';
import TabList from '@mui/lab/TabList';
import TabPanel from '@mui/lab/TabPanel';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import { grey } from '@mui/material/colors';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import MUILink from '@mui/material/Link';
import Tab from '@mui/material/Tab';
import Typography from '@mui/material/Typography';
import type { MRT_ColumnDef } from 'material-react-table';
import {
  MaterialReactTable,
  useMaterialReactTable,
} from 'material-react-table';
import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';

export type BatchCreateResultDialogProps = {
  workspaceId: string;
  environmentId: string;
  baseUrl: string;
  providersMap: Record<string, AiProviderDto>;
  data: {
    connections: {
      request: { name: string; provider: string };
      response: ApiResponse<AiConnectionEntity>;
    }[];
    resources?: {
      request: { name: string };
      response: ApiResponse<AiResourceEntity>;
    }[];
  };
  onClose: () => void;
};

export default function BatchCreateResultDialog({
  workspaceId,
  environmentId,
  baseUrl,
  providersMap,
  data: rawData,
  onClose,
}: BatchCreateResultDialogProps) {
  const [selectedTab, setSelectedTab] = useState('1');

  const [open, setOpen] = useState(true);
  const data = useMemo(() => {
    return rawData.connections.map((connection, index) => {
      const resource = rawData.resources?.[index];

      return {
        provider: connection.request.provider,
        connection: connection.response.data
          ? connection.response.data
          : { name: connection.request.name },
        resource: resource
          ? resource.response.data
            ? resource.response.data
            : { name: resource.request.name }
          : undefined,
        error: !connection.response.data
          ? connection.response.error.errorMessage
          : resource
          ? !resource.response.data
            ? resource.response.error.errorMessage
            : undefined
          : undefined,
      };
    });
  }, [rawData]);

  const handleClose = () => {
    setOpen(false);
    onClose();
  };

  const columns: MRT_ColumnDef<{
    provider: string;
    connection: AiConnectionEntity | { name: string };
    resource?: AiResourceEntity | { name: string };
    error?: string;
  }>[] = [
    {
      header: 'Status',
      size: 100,
      Cell: ({ row: { original: row } }) =>
        row.error ? (
          <Chip size="small" label="Failed" color="error" />
        ) : (
          <Chip size="small" label="Success" color="success" />
        ),
    },
    {
      header: 'Provider',
      Cell: ({ row: { original: row } }) => (
        <Chip
          key={row.provider}
          label={providersMap[row.provider]?.name ?? row.provider}
          icon={
            <Box>
              <Image
                alt={providersMap[row.provider]?.name ?? row.provider}
                src={providersMap[row.provider].config.logo.url}
                height={24}
                width={24}
              />
            </Box>
          }
        />
      ),
    },
    {
      header: 'AI Connection',
      Cell: ({ row: { original: row } }) =>
        'connectionId' in row.connection ? (
          <MUILink
            component={Link}
            href={`/workspaces/${workspaceId}/${environmentId}/ai-connections/edit/${row.connection.connectionId}/general`}
            variant="body2"
          >
            {row.connection.name}
          </MUILink>
        ) : (
          row.connection.name
        ),
    },
    {
      header: 'AI Resource',
      Cell: ({ row: { original: row } }) =>
        row.resource ? (
          'resourceId' in row.resource ? (
            <MUILink
              component={Link}
              href={`/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${row.resource.resourceId}/general`}
              variant="body2"
            >
              {row.resource.name}
            </MUILink>
          ) : (
            row.resource.name
          )
        ) : (
          'N/A'
        ),
    },
    {
      accessorKey: 'error',
      header: 'Error Message',
    },
  ];

  const table = useMaterialReactTable({
    columns,
    data,
    enablePagination: false,
    enableFullScreenToggle: false,
    enableBottomToolbar: false,
    enableSorting: false,
    enableFilters: false,
    enableTopToolbar: false,
    initialState: {
      density: 'compact',
      expanded: true,
    },
    muiTablePaperProps: {
      elevation: 0,
    },
  });

  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
        aria-labelledby="batch-create-result-dialog-title"
        aria-describedby="batch-create-result-dialog-description"
        maxWidth="xl"
        fullWidth
      >
        <DialogTitle id="batch-create-result-dialog-title">
          Quick Create Result
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2}>
            <Grid size={12}>
              <MaterialReactTable table={table} />
            </Grid>

            <Grid size={12} marginTop={1}>
              <Typography variant="h6">AI Resources</Typography>
              <Divider />

              <TabContext value={selectedTab}>
                <Box
                  sx={{ borderBottom: 1, borderColor: 'divider', marginTop: 1 }}
                >
                  <TabList
                    onChange={(_, newValue) => setSelectedTab(`${newValue}`)}
                    aria-label="Resources"
                  >
                    {data.map((item, index) => {
                      if (!item.resource || !('resource' in item.resource)) {
                        return <></>;
                      }

                      return (
                        <Tab
                          key={index}
                          label={item.resource.name}
                          value={`${index + 1}`}
                        />
                      );
                    })}
                  </TabList>
                </Box>
                {data.map((item, index) => {
                  if (!item.resource || !('resourceId' in item.resource)) {
                    return <></>;
                  }

                  return (
                    <TabPanel value={`${index + 1}`} key={index}>
                      <Grid container spacing={1}>
                        <Grid size={8}>
                          <SDKDetails
                            workspaceId={workspaceId}
                            environmentId={environmentId}
                            baseUrl={baseUrl}
                            showEnvironmentDetails={false}
                            resource={item.resource.name}
                          />
                        </Grid>
                        <Grid size={4}>
                          <Grid size={12}>
                            <Typography variant="h6">Playground</Typography>
                            <Divider />
                          </Grid>
                          <Box
                            sx={{
                              border: `1px solid ${grey[300]}`,
                              marginTop: 1,
                            }}
                          >
                            <Chat
                              resource={item.resource}
                              providersMap={providersMap}
                              workspaceId={workspaceId}
                              environmentId={environmentId}
                              height="33.4rem"
                              stream={true}
                              padding={0}
                              elevation={0}
                            />
                          </Box>
                        </Grid>
                      </Grid>
                    </TabPanel>
                  );
                })}
              </TabContext>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button
            color="primary"
            variant="contained"
            onClick={handleClose}
            autoFocus
          >
            Dismiss
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
