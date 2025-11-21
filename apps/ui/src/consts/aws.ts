export const AWS_REGIONS = [
  {
    label: 'N. Virginia',
    value: 'us-east-1',
  },
  {
    label: 'Ohio',
    value: 'us-east-2',
  },
  {
    label: 'N. California',
    value: 'us-west-1',
  },
  {
    label: 'Oregon',
    value: 'us-west-2',
  },
  {
    label: 'Canada (Central)',
    value: 'ca-central-1',
  },
  {
    label: 'Sao Paulo',
    value: 'sa-east-1',
  },
  {
    label: 'Ireland',
    value: 'eu-west-1',
  },
  {
    label: 'London',
    value: 'eu-west-2',
  },
  {
    label: 'Paris',
    value: 'eu-west-3',
  },
  {
    label: 'Frankfurt',
    value: 'eu-central-1',
  },
  {
    label: 'Milan',
    value: 'eu-south-1',
  },
  {
    label: 'Stockholm',
    value: 'eu-north-1',
  },
  {
    label: 'Singapore',
    value: 'ap-southeast-1',
  },
  {
    label: 'Sydney',
    value: 'ap-southeast-2',
  },
  {
    label: 'Tokyo',
    value: 'ap-northeast-1',
  },
  {
    label: 'Seoul',
    value: 'ap-northeast-2',
  },
  {
    label: 'Mumbai',
    value: 'ap-south-1',
  },
  {
    label: 'Hong Kong',
    value: 'ap-east-1',
  },
  {
    label: 'Bahrain',
    value: 'me-south-1',
  },
  {
    label: 'Cape Town',
    value: 'af-south-1',
  },
];

export const AWS_REGIONS_MAP = AWS_REGIONS.reduce<Record<string, string>>((acc, { label, value }) => {
  acc[value] = label;
  return acc;
}, {});
