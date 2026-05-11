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
import { useResolvedColorScheme } from '@/hooks/use-resolved-color-scheme';
import {
  type EndpointDefinition,
  type EndpointId,
  type Language,
  getEndpoints,
} from './snippets';

export type SDKDetailsProps = {
  workspaceId: string;
  environmentId: string;
  baseUrl: string;
  resource?: string;
};

const LANGUAGE_LABELS: Record<Language, string> = {
  nodejs: 'Node.js',
  python: 'Python',
  curl: 'cURL',
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
  const monacoTheme = useResolvedColorScheme() === 'dark' ? 'vs-dark' : 'vs';
  const [endpointId, setEndpointId] = useState<EndpointId>('chat');
  const [language, setLanguage] = useState<Language>('nodejs');

  const endpoints = useMemo(
    () => getEndpoints({ workspaceId, environmentId, baseUrl, resourceName }),
    [workspaceId, environmentId, baseUrl, resourceName]
  );

  return (
    <Grid container spacing={3}>
      <Grid size={12}>
        <Typography variant="h6">Completion API Adapters</Typography>
        <Divider />
        <Typography variant="caption" color="text.secondary">
          Same workspace + environment, three request shapes. Pick the one that
          matches the SDK you&apos;re already using.
        </Typography>
      </Grid>
      <Grid size={12}>
        <Box sx={{ width: '100%', typography: 'body1' }}>
          {/* Outer tabs — endpoint shape */}
          <TabContext value={endpointId}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <TabList
                onChange={(_, v) => setEndpointId(v as EndpointId)}
                aria-label="Endpoint adapter"
              >
                {endpoints.map((ep) => (
                  <Tab key={ep.id} label={ep.label} value={ep.id} />
                ))}
              </TabList>
            </Box>
            {endpoints.map((ep) => (
              <TabPanel key={ep.id} value={ep.id} sx={{ p: 0, pt: 2 }}>
                <EndpointPanel
                  endpoint={ep}
                  language={language}
                  onLanguageChange={setLanguage}
                  monacoTheme={monacoTheme}
                />
              </TabPanel>
            ))}
          </TabContext>
        </Box>
      </Grid>
    </Grid>
  );
}

type EndpointPanelProps = {
  endpoint: EndpointDefinition;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  monacoTheme: 'vs' | 'vs-dark';
};

function EndpointPanel({
  endpoint,
  language,
  onLanguageChange,
  monacoTheme,
}: EndpointPanelProps) {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {endpoint.description}
      </Typography>
      {/* Inner tabs — language */}
      <TabContext value={language}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <TabList
            onChange={(_, v) => onLanguageChange(v as Language)}
            aria-label="Code language"
          >
            {endpoint.snippets.map((s) => (
              <Tab
                key={s.language}
                label={LANGUAGE_LABELS[s.language]}
                value={s.language}
              />
            ))}
          </TabList>
        </Box>
        {endpoint.snippets.map((snippet) => (
          <TabPanel
            key={snippet.language}
            value={snippet.language}
            sx={{ p: 0 }}
          >
            <Box
              sx={{
                border: 1,
                borderColor: 'divider',
                borderTop: 0,
              }}
            >
              <Editor
                height="320px"
                theme={monacoTheme}
                options={{ readOnly: true, minimap: { enabled: false } }}
                defaultLanguage={snippet.monaco}
                language={snippet.monaco}
                value={snippet.code}
              />
            </Box>
          </TabPanel>
        ))}
      </TabContext>
    </Box>
  );
}
