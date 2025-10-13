# Earthdata Pub Upload <!-- omit from toc -->

This is the upload module code repository for Earthdata Pub.

## Table of Contents

- [Table of Contents](#table-of-contents)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Usage](#usage)
  - [Testing](#testing)

### Prerequisites

The following are required for following the packaging and deploying steps:

- [Amazon AWS](https://aws.amazon.com/) An AWS account is required for live deployment.
- [Terraform](https://github.com/hashicorp/terraform) AWS components are
  provisioned using Terraform v1.0.0.
- [Node.js](https://nodejs.org/en/download/) AWS Lambda functions and layers are
  implemented in Node.js 22.14.0. The Node Package Manager is also required but included
  with a standard Node.js installation.
- [Docker](https://www.docker.com/) Docker is used to create the local test
  environment including the following services Postgresql, PgAdmin, GoAws for
  mocking SNS and SQS, Node OASTools for serving the API.

### Installation

```
npm install @edpub/upload-utility
```

### Usage

The below example shows how the EDPub Upload Utility can be used to upload a file to S3.

```javascript
import { CueFileUtility } from '@edpub/upload-utility';

const uploadUtil = new CueFileUtility();

const payload = {
  fileObj: file,
  authToken: 'Bearer <my_auth_token_value>',
  apiEndpoint: 'https://my-site.com/download',
  submissionId: '8e475eb1-1558-4115-ad52-a09962964873',
  endpointParams: {
    file_category: 'file category'
  }
};
const updateProgress = (progress, fileObj) => {};
uploadUtil.uploadFile(payload, updateProgress);

```

The `updateProgress` method is used for tracking progress of an upload. Below is an example of what that method might look where the application is tracking the file's upload progress for something like displaying a progress bar in a React application.

```javascript
const updateProgress = (progress, fileObj) => {
  setUploadProgress((previousState) => ({
    ...previousState,
    [fileObj.name]: progress,
  }));
};
```

The EDPub Upload Utility can also be used to download a file from S3.

```javascript
import { CueFileUtility } from '@edpub/upload-utility';

const uploadUtil = new CueFileUtility();

const s3Prefix = 'prefix/location/test.txt';
const downloadAPIEndpoint = 'https://my-site.com/download';
const authenticationToken = 'Bearer <my_auth_token_value>';

download.downloadFile(s3Prefix, downloadAPIEndpoint, authenticationToken);
```


### Testing

[Jest](https://jestjs.io/) is used for unit testing Lambda functions and Lambda
layers. Jest configuration is located in `jest.config.js`.

```bash
npm run test
```