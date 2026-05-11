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
import { useMemo, useState } from 'react';
import { useResolvedColorScheme } from '@/hooks/use-resolved-color-scheme';
import {
  type AdvancedPatternDefinition,
  type AdvancedPatternId,
  getAdvancedPatterns,
} from './advanced-snippets';
import type { Language } from './snippets';

export type AdvancedPatternsGuideProps = {
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

/**
 * Three opt-in patterns that aren't part of the basic Chat Completions /
 * Responses / Anthropic Messages snippets:
 *
 *   1. `vmx.resourceConfigOverrides` — per-request resource patch.
 *   2. `vmx.metadata` — caller tags surfacing on audit + metrics.
 *   3. `<connection name>/<model>` — bypass the resource layer.
 *
 * Mirrors `OpenAIAdapterGuide`'s endpoint × language tab layout so
 * the feel is consistent across the SDK page.
 */
export default function AdvancedPatternsGuide({
  workspaceId,
  environmentId,
  baseUrl,
  resource,
}: AdvancedPatternsGuideProps) {
  const resourceName = useMemo(
    () => resource || '<VM_X_RESOURCE_NAME>',
    [resource]
  );
  const monacoTheme = useResolvedColorScheme() === 'dark' ? 'vs-dark' : 'vs';
  const [patternId, setPatternId] = useState<AdvancedPatternId>('overrides');
  const [language, setLanguage] = useState<Language>('nodejs');

  const patterns = useMemo(
    () =>
      getAdvancedPatterns({
        workspaceId,
        environmentId,
        baseUrl,
        resourceName,
      }),
    [workspaceId, environmentId, baseUrl, resourceName]
  );

  return (
    <Grid container spacing={3}>
      <Grid size={12}>
        <Typography variant="h6">Advanced patterns</Typography>
        <Divider />
        <Typography variant="caption" color="text.secondary">
          Three escape hatches for the cases the basic adapter examples
          don&apos;t cover — overriding a resource just for one request, tagging
          requests with caller metadata, or skipping the resource layer
          entirely.
        </Typography>
      </Grid>
      <Grid size={12}>
        <Box sx={{ width: '100%', typography: 'body1' }}>
          <TabContext value={patternId}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <TabList
                onChange={(_, v) => setPatternId(v as AdvancedPatternId)}
                aria-label="Advanced pattern"
                variant="scrollable"
                allowScrollButtonsMobile
              >
                {patterns.map((p) => (
                  <Tab key={p.id} label={p.label} value={p.id} />
                ))}
              </TabList>
            </Box>
            {patterns.map((p) => (
              <TabPanel key={p.id} value={p.id} sx={{ p: 0, pt: 2 }}>
                <PatternPanel
                  pattern={p}
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

type PatternPanelProps = {
  pattern: AdvancedPatternDefinition;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  monacoTheme: 'vs' | 'vs-dark';
};

function PatternPanel({
  pattern,
  language,
  onLanguageChange,
  monacoTheme,
}: PatternPanelProps) {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {pattern.description}
      </Typography>
      <TabContext value={language}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <TabList
            onChange={(_, v) => onLanguageChange(v as Language)}
            aria-label="Code language"
          >
            {pattern.snippets.map((s) => (
              <Tab
                key={s.language}
                label={LANGUAGE_LABELS[s.language]}
                value={s.language}
              />
            ))}
          </TabList>
        </Box>
        {pattern.snippets.map((snippet) => (
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
