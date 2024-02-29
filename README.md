# Earthdata Pub Upload

This is the upload module code repository for Earthdata Pub.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installing](#installing)
- [Building and running locally](#building-and-running-locally)
- [Testing](#testing)

### Prerequisites

The following are required for following the packaging and deploying steps:

- [Amazon AWS](https://aws.amazon.com/) An AWS account is required for live deployment.
- [Terraform](https://github.com/hashicorp/terraform) AWS components are
  provisioned using Terraform v1.0.0.
- [Node.js](https://nodejs.org/en/download/) AWS Lambda functions and layers are
  implemented in Node.js 18.14.1. The Node Package Manager is also required but included
  with a standard Node.js installation.
- [Docker](https://www.docker.com/) Docker is used to create the local test
  environment including the following services Postgresql, PgAdmin, GoAws for
  mocking SNS and SQS, Node OASTools for serving the API.

### Installing

The first step is to clone the repo!

```bash
git clone https://github.com/eosdis-nasa/earthdata-pub-upload.git
cd upload
npm install
```

### Building and running locally

To build and run a local instance execute:

```bash
cd ../earthdata-pub-dashboard
npm i
cd ../earthdata-pub-upload
```

This will install the upload module in your local dashboard stack.

To launch your local EDPub stack execute:

```bash
cd ../earthdata-pub-forms
npm run start-dev
cd ../earthdata-pub-upload
```

Due to limitations when attempting to imitate cloud resources the upload module will run with errors locally.


## Testing

[Jest](https://jestjs.io/) is used for unit testing Lambda functions and Lambda
layers. Jest configuration is located in `jest.config.js`.

```bash
npm run test
```