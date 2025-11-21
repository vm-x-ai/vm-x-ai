'use client';

import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import type { SxProps, Theme } from '@mui/material/styles';
import AppContainer from '../Layout/Container';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import AccordionDetails from '@mui/material/AccordionDetails';

export type TabContentFoldableProps = {
  title: string;
  children: React.ReactNode;
  titleSx?: SxProps<Theme>;
  actionElement?: React.ReactNode;
  defaultOpen?: boolean;
};

export default function TabContentFoldable({
  title,
  children,
  titleSx,
  actionElement,
  defaultOpen = false,
}: TabContentFoldableProps) {
  return (
    <AppContainer sx={{ p: 0 }}>
      <Accordion defaultExpanded={defaultOpen}>
        {/* Header with Chevron, Title, and Action Element */}
        <AccordionSummary
          expandIcon={
            <IconButton size="small" aria-label="toggle content">
              <ExpandMoreIcon fontSize="small" />
            </IconButton>
          }
          aria-controls="panel-content"
          id="panel-header"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between', // Creates flexible gap between title and action element
            padding: '0.5rem 1rem',
            cursor: 'pointer',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography
              component="span"
              variant="body2"
              sx={{
                flex: 1, // Ensures title takes up available space
                ...titleSx,
              }}
            >
              {title}
            </Typography>
          </Box>
          {/* Optional Action Element */}
          {actionElement && <Box sx={{ marginLeft: 'auto' }}>{actionElement}</Box>}
        </AccordionSummary>

        {/* Collapsible Content */}
        <AccordionDetails sx={{ padding: '1rem' }}>{children}</AccordionDetails>
      </Accordion>
    </AppContainer>
  );
}
