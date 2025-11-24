'use client';

import { Editor } from '@monaco-editor/react';
import TabContext from '@mui/lab/TabContext';
import TabList from '@mui/lab/TabList';
import TabPanel from '@mui/lab/TabPanel';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Tab from '@mui/material/Tab';
import Typography from '@mui/material/Typography';
import React, { useMemo, useState } from 'react';
import dedent from 'string-dedent';

export type SDKDetailsProps = {
  workspaceId: string;
  environmentId: string;
  baseUrl: string;
  resource?: string;
};

export default function OpenAIAdapterGuide({
  workspaceId,
  environmentId,
  baseUrl,
  resource,
}: SDKDetailsProps) {
  const resourceName = useMemo(
    () => resource || '<VM_X_RESOURCE_NAME>',
    [resource]
  );
  const [value, setValue] = useState('nodejs');

  const handleChange = (event: React.SyntheticEvent, newValue: string) => {
    setValue(newValue);
  };

  return (
    <Grid container spacing={3}>
      <Grid size={12}>
        <Typography variant="h6">OpenAI Completion API Adapter</Typography>
        <Divider />
      </Grid>
      <Grid size={12}>
        <Box sx={{ width: '100%', typography: 'body1' }}>
          <TabContext value={value}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <TabList
                onChange={handleChange}
                aria-label="lab API tabs example"
              >
                <Tab label="Node.js" value="nodejs" />
                <Tab label="Python" value="python" />
                <Tab label="cURL" value="curl" />
              </TabList>
            </Box>
            <Box border={1} borderColor="divider" borderTop={0}>
              <TabPanel value="nodejs">
                <Editor
                  height="300px"
                  options={{
                    readOnly: true,
                  }}
                  defaultLanguage="typescript"
                  defaultValue={dedent`
                  import OpenAI from "openai";

                  const workspaceId = "${workspaceId}";
                  const environmentId = "${environmentId}";
                  const resourceName = "${resourceName}";

                  const openai = new OpenAI({
                    baseURL: \`${baseUrl}/v1/completion/\${workspaceId}/\${environmentId}/\${resourceName}\`,
                    apiKey: '<VM_X_API_KEY>',
                  });

                  async function main() {
                    const completion = await openai.chat.completions.create({
                      messages: [{ role: "system", content: "You are a helpful assistant." }],
                      model: "gpt-4o",
                    });

                    console.log(completion.choices[0]);
                  }

                  main();
                  `}
                />
              </TabPanel>
              <TabPanel value="python">
                <Editor
                  height="300px"
                  options={{
                    readOnly: true,
                  }}
                  defaultLanguage="python"
                  defaultValue={dedent`
                  from openai import OpenAI

                  workspace_id = "${workspaceId}"
                  environment_id = "${environmentId}"
                  resource_name = "${resourceName}"

                  client = OpenAI(
                      base_url=f'${baseUrl}/v1/completion/{workspace_id}/{environment_id}/{resource_name}',
                      api_key='<VM_X_API_KEY>',
                  )

                  completion = client.chat.completions.create(
                      model="gpt-4o",
                      messages=[
                          {"role": "system", "content": "You are a helpful assistant."},
                          {"role": "user", "content": "Hello!"}
                      ]
                  )

                  print(completion.choices[0].message)
                  `}
                />
              </TabPanel>
              <TabPanel value="curl">
                <Editor
                  height="300px"
                  options={{
                    readOnly: true,
                  }}
                  defaultLanguage="shell"
                  defaultValue={dedent`
                  export WORKSPACE_ID="${workspaceId}"
                  export ENVIRONMENT_ID="${environmentId}"
                  export RESOURCE_NAME="${resourceName}"
                  export VM_X_API_KEY="<VM_X_API_KEY>"

                  curl ${baseUrl}/v1/completion/$WORKSPACE_ID/$ENVIRONMENT_ID/$RESOURCE_NAME/chat/completions \\
                    -H "Content-Type: application/json" \\
                    -H "Authorization: Bearer $VM_X_API_KEY" \\
                    -d '{
                      "model": "gpt-4o",
                      "messages": [
                        {
                          "role": "system",
                          "content": "You are a helpful assistant."
                        },
                        {
                          "role": "user",
                          "content": "Hello!"
                        }
                      ]
                    }'
                  `}
                />
              </TabPanel>
            </Box>
          </TabContext>
        </Box>
      </Grid>
    </Grid>
  );
}
