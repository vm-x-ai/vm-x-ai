#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { EKSStack } from '../lib/eks-stack.js';

const app = new cdk.App();
new EKSStack(app, 'vm-x-ai-eks-example', {});
