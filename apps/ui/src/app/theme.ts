'use client';

import { createTheme } from '@mui/material/styles';
import { Roboto } from 'next/font/google';

const roboto = Roboto({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
});

const theme = createTheme({
  typography: {
    fontFamily: roboto.style.fontFamily,
  },
  colorSchemes: {
    light: {
      palette: {
        primary: {
          main: '#112A7C', // VM-X Dark blue
        },
        secondary: {
          main: '#1691cf', // VM-X Light blue
          light: '#b3e5fc', // Light blue for hover
        },
      },
    },
  },
  cssVariables: true,
});

export default theme;
