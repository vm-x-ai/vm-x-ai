import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import clsx from 'clsx';
import styles from './styles.module.css';
import { ReactNode } from 'react';

type FeatureItem = {
  title: string;
  description: ReactNode;
  link: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Provider Abstraction',
    description: (
      <>
        <strong>Unified API for all AI providers.</strong> VM-X AI introduces an
        abstraction layer between your code and AI inference providers. Use the
        standard OpenAI SDK to connect to any supported provider—OpenAI,
        Anthropic, Google Gemini, Groq, or AWS Bedrock—without changing your
        code.
      </>
    ),
    link: '/docs/intro',
  },
  {
    title: 'Dynamic Routing',
    description: (
      <>
        <strong>Intelligent request routing.</strong> Automatically route
        requests to different models based on token count, error rates, tool
        usage, or content analysis. Configure complex routing rules with full
        control over when and how requests are distributed across providers.
      </>
    ),
    link: '/docs/features/ai-resources/routing',
  },
  {
    title: 'Automatic Fallback',
    description: (
      <>
        <strong>High availability guaranteed.</strong> Ensure your AI workloads
        never fail by configuring automatic fallback chains. When a primary
        model fails, VM-X AI automatically switches to alternative providers,
        protecting against outages and errors.
      </>
    ),
    link: '/docs/features/ai-resources/fallback',
  },
  {
    title: 'Capacity Prioritization',
    description: (
      <>
        <strong>Intelligent capacity allocation.</strong> Allocate capacity
        across multiple resources using adaptive token scaling. Define priority
        pools with min/max reservations and let VM-X AI dynamically adjust
        allocation based on actual usage patterns.
      </>
    ),
    link: '/docs/features/prioritization',
  },
];

function Feature({ title, link, description }: FeatureItem) {
  return (
    <div className={clsx('col card margin-horiz--sm')}>
      <div className="text--center padding-horiz--md card__header">
        <Heading as="h3">{title}</Heading>
      </div>
      <div className="text--center padding-horiz--md card__body">
        <p>{description}</p>
      </div>
      <div className="text--center card__footer">
        <Link
          className="button button--block button--outline button--primary button--md"
          to={link}
        >
          Read more
        </Link>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
