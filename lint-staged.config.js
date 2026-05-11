module.exports = {
  '*': ['pnpm nx format:write'],
  '{packages,docs,examples}/**/*.{ts,js,jsx,tsx,json,yaml,md,html,css,scss}': [
    'pnpm nx affected --target lint --fix true',
  ],
};
