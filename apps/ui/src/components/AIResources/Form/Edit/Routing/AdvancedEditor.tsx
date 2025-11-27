import CodeIcon from '@mui/icons-material/Code';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import { blue, grey } from '@mui/material/colors';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Markdown from '@/components/Markdown';
import ejs from 'ejs';
import React, { useState } from 'react';
import AceEditor from 'react-ace';
import { toast } from 'react-toastify';

import 'ace-builds/src-noconflict/ext-language_tools';
import 'ace-builds/src-noconflict/mode-ejs';
import 'ace-builds/src-noconflict/mode-json';
import 'ace-builds/src-noconflict/theme-github';
import { AiRoutingConditionGroup } from '@/clients/api';

export type AdvancedEditorProps = {
  route: AiRoutingConditionGroup;
  onChange?: (route: AiRoutingConditionGroup) => void;
};

const defaultExpression = `
<%
// This is an example of an advanced rule expression
function shouldRoute() {
  return tokens.input > 10;
}

return shouldRoute();
%>
`;

const defaultInput = JSON.stringify(
  {
    request: {
      messages: [
        {
          role: 'system',
          content: 'You are a useful bot, be polite',
        },
        {
          role: 'user',
          content: 'Hi there!',
        },
      ],
      lastMessages: {
        role: 'user',
        content: 'Hi there!',
      },
      allMessagesContent: 'You are a useful bot, be polite Hi there!',
      firstMessage: {
        role: 'system',
        content: 'You are a useful bot, be polite',
      },
      messagesCount: 2,
      toolsCount: 0,
    },
    tokens: {
      input: 10,
      maxOutput: 2048,
    },
  },
  null,
  2,
);

export default function AdvancedEditor({ route, onChange }: AdvancedEditorProps) {
  const [compilationError, setCompilationError] = useState<string | null>(null);
  const [input, setInput] = useState<string>(defaultInput);

  console.log('compilationError', compilationError);

  return (
    <Box
      sx={{
        width: 'calc(100% - 2em)',
        mb: 1,
        ml: '2em',
        border: `1px solid ${grey[300]}`,
        borderRadius: 2,
      }}
    >
      {/* Header Section Styled Like RuleCard */}
      <Box
        sx={{
          backgroundColor: blue[50],
          borderRadius: '8px 8px 0 0',
          height: '2.5em',
          p: 2,
          pl: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box display="flex" alignItems="center">
          <Typography variant="body2" sx={{ fontWeight: 'bold', ml: 1 }}>
            Advanced Rule Editor
          </Typography>
        </Box>
        <Box>
          <Tooltip title="Compile">
            <IconButton
              size="small"
              sx={{ color: grey[600], p: 0.5 }}
              onClick={() => {
                try {
                  setCompilationError(null);
                  const result = ejs.render(route.expression ?? defaultExpression, JSON.parse(input));
                  if (typeof result !== 'boolean') {
                    setCompilationError('Expression should return a boolean value');
                    return;
                  }

                  toast.success('Expression compiled successfully');
                } catch (error) {
                  setCompilationError(`\`\`\`log\n${(error as Error).name}\n\n${(error as Error).message}\n\`\`\``);
                }
              }}
            >
              <CodeIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Text Field Section */}
      <Box sx={{ mt: 2, px: 2, pb: 2 }}>
        <Box
          sx={{
            display: 'flex',
            width: '100%',
            gap: 1,
          }}
        >
          <Box width="50%">
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
              Rule Expression
            </Typography>
            <AceEditor
              mode="ejs"
              width="100%"
              theme="github"
              height="20rem"
              onChange={(value) => {
                onChange?.({ ...route, expression: value });
              }}
              name="expression-editor"
              value={route.expression ?? defaultExpression}
              editorProps={{ $blockScrolling: true }}
              setOptions={{
                showGutter: true,
                enableBasicAutocompletion: true,
                enableLiveAutocompletion: true,
                enableSnippets: true,
                wrap: true,
                tabSize: 2,
                fontSize: 16,
                enableKeyboardAccessibility: true,
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
              }}
            />
          </Box>
          <Box width="50%">
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
              Input Data
            </Typography>
            <AceEditor
              mode="json"
              width="100%"
              theme="github"
              height="20rem"
              onChange={(value) => {
                setInput(value);
              }}
              name="input-editor"
              value={input}
              editorProps={{ $blockScrolling: true }}
              setOptions={{
                showGutter: true,
                enableBasicAutocompletion: true,
                enableLiveAutocompletion: true,
                enableSnippets: true,
                wrap: true,
                tabSize: 2,
                fontSize: 16,
                enableKeyboardAccessibility: true,
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
              }}
            />
          </Box>
        </Box>

        {compilationError && (
          <Alert
            sx={{
              marginTop: '1rem',
            }}
            severity="error"
            variant="outlined"
          >
            <Markdown>{compilationError}</Markdown>
          </Alert>
        )}
      </Box>
    </Box>
  );
}
