const got = require('got');
const cheerio = require('cheerio');
const AWS = require('aws-sdk');
const config = require('./config');

AWS.config.update({region: config.awsRegion});

const sqs = new AWS.SQS({apiVersion: '2012-11-05'});

(async () => {
    const response = await got(config.newPhotosUrl);
    const $ = cheerio.load(response.body);

    const tableRows = $('#ctl00_ContentPlaceHolder1_Thumbnails_ThumbList_PicList').find('tbody').find('tr').toArray();//.each((idx, row) => {

    for(const row of tableRows) {
        try {
            const dataCells = $(row).find('table').find('tr').children();
            
            const imageCell = dataCells.eq(0);
            const photoLink = imageCell.find('a');
            const photoUrl = photoLink.attr('href');

            // Seem to get more TRs than what we want, so using this to check if we should continue parsing
            if (!photoUrl) {
                continue;
            }
            
            console.log('link', photoLink.attr('href'));

            const detailTable = dataCells.eq(1).find('.DefText');
            const detailTableRows = detailTable.find('tr');

            const title = detailTableRows.eq(0).find('td').eq(1).text();

            const dates = detailTableRows.eq(2).find('td').eq(1).text().trim();
            const dateRegex = /^(\d{1,2}\/\d{1,2}\/\d{4})\s.Upload Date:\s(\d{1,2}\/\d{1,2}\/\d{4}\s\d{1,2}\:\d{1,2}\:\d{1,2}\s[A|P]M)$/;

            const dateParts = dateRegex.exec(dates);
            const photoDate = dateParts[1];
            const uploadDate = dateParts[2];
        
            var messageParams = {
                MessageAttributes: {
                    'DiscoveredOn': {
                        DataType: 'String',
                        StringValue: new Date().toString()
                    },
                    'ImageUrl': {
                        DataType: 'String',
                        StringValue: photoUrl
                    },
                    'PhotoDate': {
                        DataType: 'String',
                        StringValue: photoDate
                    },
                    'UploadDate': {
                        DataType: 'String',
                        StringValue: uploadDate
                    },
                    'Title': {
                        DataType: 'String',
                        StringValue: title
                    }
                },
                MessageBody: `Image URL '${photoUrl}' discovered`,
                QueueUrl: config.sqsQueueUrl
            };

            sqs.sendMessage(messageParams, function(err, data) {
                if (err) {
                    console.error('Error sending to SQS', err);
                } else { 
                    console.log(`Sent '${photoUrl}'. MessageID:'${data.MessageId}' to SQS`);
                }
            });
        } catch(err) {
            console.error('Error fetching image row details', err);
        }
    }
    
})();
