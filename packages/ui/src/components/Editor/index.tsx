/* eslint-disable @typescript-eslint/no-non-null-assertion */
'use client';

import {
  Editor as MonacoEditor,
  EditorProps as MonacoEditorProps,
} from '@monaco-editor/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { editor } from 'monaco-editor';
import { cn } from '@/lib/utils';
import useDebounceValue from '@/hooks/use-debounce-value';
import { useResolvedColorScheme } from '@/hooks/use-resolved-color-scheme';
import Tooltip from '@mui/material/Tooltip';

export type EditorProps = Omit<MonacoEditorProps, 'theme' | 'onChange'> & {
  onChange?: (value: string, parsed?: Record<string, unknown>) => void;
  showMarkers?: boolean;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
};

export type EditorOnChangeHandlerProps = {
  language: string;
  onChange?: (value: string, parsed?: Record<string, unknown>) => void;
};

export type Monaco = typeof import('monaco-editor');

export type OnChangeHandlerFn = (
  value: string,
  model: editor.ITextModel,
  monaco: Monaco
) => void;

export function useEditorOnChangeHandler({
  language,
  onChange,
}: EditorOnChangeHandlerProps) {
  const [markers, setMarkers] = useState<editor.IMarkerData[]>([]);

  const languageOnChangeHandler = useMemo<
    Record<string, OnChangeHandlerFn>
  >(() => {
    return {
      json: (value: string, model: editor.ITextModel, monaco: Monaco) => {
        setMarkers([]);
        monaco.editor.setModelMarkers(model, language, []);
        try {
          const parsed = JSON.parse(value ?? '{}');
          onChange?.(value ?? '', parsed);
        } catch (error) {
          if (error instanceof SyntaxError) {
            const markers: editor.IMarkerData[] = [
              {
                severity: monaco.MarkerSeverity.Error,
                message: error.message,
                startLineNumber: 0,
                startColumn: 0,
                endLineNumber: 0,
                endColumn: 0,
              },
            ];
            setMarkers(markers);
            monaco.editor.setModelMarkers(model, language, markers);
          }
        }
      },
      default: (value: string, model: editor.ITextModel, monaco: Monaco) => {
        setMarkers([]);
        monaco.editor.setModelMarkers(model, language, []);
        onChange?.(value ?? '');
      },
    };
  }, [language, onChange]);

  return {
    onChangeHandler:
      languageOnChangeHandler[language] ?? languageOnChangeHandler.default,
    markers,
  };
}

export default function Editor({
  options,
  onChange,
  showMarkers = true,
  tooltipSide = 'bottom',
  ...props
}: EditorProps) {
  const [value, setValue] = useState<string>('');
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const language = props.language ?? 'default';

  const { onChangeHandler, markers } = useEditorOnChangeHandler({
    language,
    onChange,
  });

  // Track the active MUI scheme so Monaco's chrome (background, gutter,
  // syntax theme) follows the rest of the UI. `useResolvedColorScheme`
  // is the canonical resolver for the cssVariables + colorSchemes setup
  // — `useTheme().palette.mode` would stay pinned at the default.
  const monacoTheme = useResolvedColorScheme() === 'dark' ? 'vs-dark' : 'vs';

  useEffect(() => {
    if (!editorRef.current?.hasTextFocus()) {
      setValue(props.value ?? '');
    }
  }, [props.value]);

  const deplayedMarkers = useDebounceValue(
    markers,
    markers.length > 0 ? 1000 : 0
  );

  return (
    <Tooltip
      title={
        showMarkers &&
        deplayedMarkers.length > 0 && (
          <>
            {markers.map((marker) => (
              <p
                key={marker.message}
                className="text-sm break-all max-w-100 text-wrap"
              >
                {marker.message}
              </p>
            ))}
          </>
        )
      }
    >
      <div className="flex flex-col w-full h-full gap-3">
        <MonacoEditor
          {...props}
          theme={monacoTheme}
          value={value}
          className={cn(
            props.className,
            deplayedMarkers.length > 0 ? 'border-1 border-red-500' : ''
          )}
          beforeMount={(monaco) => {
            props.beforeMount?.(monaco);
          }}
          onMount={(editor, monaco: Monaco) => {
            props.onMount?.(editor, monaco);
            editorRef.current = editor;
            monacoRef.current = monaco;
          }}
          onChange={(value) => {
            setValue(value ?? '');
            const model = editorRef.current?.getModel();
            if (!model) {
              return;
            }

            onChangeHandler(value ?? '', model, monacoRef.current!);
          }}
          options={{
            ...(options ?? {}),
          }}
        />
      </div>
    </Tooltip>
  );
}
