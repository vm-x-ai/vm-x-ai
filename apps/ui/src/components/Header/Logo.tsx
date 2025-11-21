'use client';

import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import Image from 'next/image';

export default function HeaderLogo() {
  const theme = useTheme();
  const isSm = useMediaQuery(theme.breakpoints.up('sm'), {
    defaultMatches: true,
  });
  const logoUrl = isSm ? '/img/logos/logo.png' : '/img/logos/logo-small.png';

  return (
    <Image
      src={logoUrl}
      width={isSm ? 100 : 45}
      height={45}
      alt="Logo"
      unoptimized
    />
  );
}
