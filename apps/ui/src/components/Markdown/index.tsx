'use client';

import MUILink from '@mui/material/Link';
import Link from 'next/link';
import React from 'react';
import BaseMarkdown from 'react-markdown';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { github } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import remarkGfm from 'remark-gfm';
import './cursor.css';

export type BaseMessageProps = {
  children: string;
  blinkingCursor?: boolean;
};

export default function Markdown({ children, blinkingCursor }: BaseMessageProps) {
  return (
    <BaseMarkdown
      remarkPlugins={[remarkGfm]}
      // className={blinkingCursor ? 'markdown-blinking-cursor' : ''}
      components={{
        a({ children, href }) {
          if (!href) {
            return <>{children}</>;
          }

          return (
            <MUILink component={Link} href={href} target="_blank">
              {children}
            </MUILink>
          );
        },
        code(props) {
          const { children, className, node, ref, ...rest } = props;
          const match = /language-(\w+)/.exec(className || '');
          return match ? (
            <SyntaxHighlighter
              {...rest}
              wrapLines={true}
              wrapLongLines={true}
              style={github}
              language={match[1]}
              PreTag="div"
            >
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          ) : (
            <code {...rest} className={className} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {children}
            </code>
          );
        },
      }}
    >
      {children}
    </BaseMarkdown>
  );
}
