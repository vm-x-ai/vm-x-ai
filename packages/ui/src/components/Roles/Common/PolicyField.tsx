'use client';

import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import { Controller, useFormContext } from 'react-hook-form';
import Editor, { Monaco } from '@/components/Editor';
import { z } from 'zod';
import { zRolePolicy } from '@/clients/api/zod.gen';
import PermissionTable from '../PermissionTable';
import Box from '@mui/material/Box';
import Markdown from '@/components/Markdown';

export const schema = z.object({
  policy: z.object(
    {
      ...zRolePolicy.shape,
    },
    {
      error: 'Policy is required.',
    }
  ),
});

export type PolicyFormSchema = z.output<typeof schema>;

export default function PolicyField() {
  const form = useFormContext<PolicyFormSchema>();
  return (
    <>
      <Grid container spacing={3}>
        <Grid size={12}>
          <Typography variant="subtitle2">Policy</Typography>
          <Divider />
        </Grid>
        <Grid container size={12} spacing={3}>
          <Grid
            size={6}
            sx={{
              paddingTop: 3,
              paddingRight: 3,
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Controller
                name="policy"
                control={form.control}
                render={({ field }) => (
                  <Editor
                    height="300px"
                    language="json"
                    value={JSON.stringify(field.value, null, 2)}
                    onChange={(_, parsed) => {
                      field.onChange(parsed);
                    }}
                    onMount={(editor, monaco: Monaco) => {
                      monaco.json.jsonDefaults.setDiagnosticsOptions({
                        schemas: [
                          {
                            uri: 'https://vm-x.ai/schema/role-policy.json',
                            schema: z.toJSONSchema(zRolePolicy),
                          },
                        ],
                      });
                    }}
                  />
                )}
              />
              <PermissionTable />
            </Box>
          </Grid>
          <Grid size={6}>
            <Box
              sx={{
                display: 'flex',
                gap: '.5rem',
                flexDirection: 'column',
                marginTop: '1rem',
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 700,
                }}
              >
                How to Use the Permissions Table & Define Your Role Policy
              </Typography>
              <Typography variant="caption">
                The table on the left provides a detailed overview of all
                available modules in the system. For each module, you can see:
              </Typography>
              <ul style={{ paddingLeft: 20, marginTop: 0, marginBottom: 0 }}>
                <li>
                  <Typography variant="caption">
                    <b>Module Name</b>: The functional area your policy will
                    control (e.g., &quot;workspace&quot;,
                    &quot;environment&quot;, &quot;user&quot;).
                  </Typography>
                </li>
                <li>
                  <Typography variant="caption">
                    <b>Actions</b>: The permissions (“verbs”) you can allow or
                    deny for the module, such as{' '}
                    <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
                      workspace:list
                    </code>{' '}
                    or{' '}
                    <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
                      user:update
                    </code>
                    . You can grant or restrict these individually or in bulk
                    using wildcards (
                    <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
                      *
                    </code>
                    ).
                  </Typography>
                </li>
                <li>
                  <Typography variant="caption">
                    <b>Base Resource</b>: Refers to the pattern for a general
                    resource in that module. Use this string in your
                    policy&apos;s{' '}
                    <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
                      resources
                    </code>{' '}
                    to target all items under the module.
                  </Typography>
                </li>
                <li>
                  <Typography variant="caption">
                    <b>Item Resource</b>: Refers to the pattern for a specific
                    item in that module. Use this string in your policy&apos;s{' '}
                    <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
                      resources
                    </code>{' '}
                    to target a specific item. For example, if the module is{' '}
                    <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
                      user
                    </code>
                    , the item resource could be{' '}
                    <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
                      &quot;user:${'{'}user.email{'}'}&quot;
                    </code>
                    .
                  </Typography>
                </li>
              </ul>
              <Typography variant="caption" sx={{ marginTop: 1 }}>
                When writing your policy below, use a JSON format with{' '}
                <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
                  statements
                </code>
                , each containing:
              </Typography>
              <ul style={{ paddingLeft: 20, marginTop: 0, marginBottom: 0 }}>
                <li>
                  <Typography variant="caption">
                    <b>effect</b>: Either{' '}
                    <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
                      &quot;allow&quot;
                    </code>{' '}
                    or{' '}
                    <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
                      &quot;deny&quot;
                    </code>
                    , determines whether the specified actions are permitted or
                    blocked.
                  </Typography>
                </li>
                <li>
                  <Typography variant="caption">
                    <b>actions</b>: A list of allowed or denied actions,
                    matching those shown in the table. You can use a specific
                    action (e.g.{' '}
                    <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
                      &quot;user:get&quot;
                    </code>
                    ), or use{' '}
                    <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
                      *
                    </code>{' '}
                    for all.
                  </Typography>
                </li>
                <li>
                  <Typography variant="caption">
                    <b>resources</b>: A list of resource patterns (from the
                    table&apos;s Base/Item Resource columns) that this statement
                    applies to. You can also use{' '}
                    <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
                      &quot;*&quot;
                    </code>{' '}
                    to apply to all resources.
                  </Typography>
                </li>
              </ul>
              <Typography variant="caption" sx={{ marginTop: 1 }}>
                <b>Example:</b>
                <br />
                To allow a user to list and view users in any workspace, but
                deny them from deleting any, you could write:
              </Typography>
              <Box
                sx={{
                  bgcolor: '#f6f8fa',
                  p: 1,
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  fontSize: '0.85em',
                  mt: 0.5,
                }}
              >
                <Markdown>
                  {`\`\`\`json
{
  "statements": [
    {
      "effect": "deny",
      "actions": ["user:delete"],
      "resources": ["*"]
    },
    {
      "effect": "allow",
      "actions": ["user:list", "user:get"],
      "resources": ["*"]
    }
  ]
}
\`\`\``}
                </Markdown>
              </Box>
              <Typography variant="caption" sx={{ marginTop: 1 }}>
                Use the information in the table to discover valid action and
                resource names and write clear, robust access policies!
              </Typography>
            </Box>
          </Grid>
        </Grid>
      </Grid>
    </>
  );
}
