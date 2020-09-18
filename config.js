const dotenv = require('dotenv');
const config = dotenv.config();
if (config.error) {
    throw config.error;
}

const { parsed: envs } = config;

const appConfig = {
    awsRegion: envs.AWS_REGION,
    sqsQueueUrl: envs.AWS_SQS_QUEUE_URL,
    sqsMaxPollSize: envs.AWS_SQS_MAX_POLL_SIZE,
    apiUrl: envs.API_URL,
    sourceSiteUrl: envs.SOURCE_SITE,
    newPhotosUrl: envs.NEW_PHOTOS_URL
};

module.exports = appConfig;