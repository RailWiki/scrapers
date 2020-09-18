const got = require('got');
const cheerio = require('cheerio');
const axios = require('axios');
const https = require('https');
const AWS = require('aws-sdk');
const luxon = require('luxon');
const config = require('./config');

AWS.config.update({region: config.awsRegion});

const sqs = new AWS.SQS({apiVersion: '2012-11-05'});

https.globalAgent.options.rejectUnauthorized = false;

const axiosInstance = axios.create({
    baseURL: config.apiUrl
});

const TABLE_ROW_KEYS = {
    withDesc: {
        title: 0,
        description: 1,
        meta_1: 2,
        meta_2: 3,
        photo: 4,
        categAlbum: 5
    },
    withoutDesc: {
        title: 0,
        meta_1: 1,
        meta_2: 2,
        photo: 3,
        categAlbum: 4,
        description: 99
    }
};

const getImageDetails = async (message) => {
    const photoUrl = `${config.sourceSiteUrl}${message.url}`;

    const pageResponse = await got(photoUrl);
    const $ = cheerio.load(pageResponse.body);

    var table = $('table').first();
    var tableRows = table.children('tbody').first().children('tr');

    // Descriptions are optional, and if they don't exist, then there is no row
    // So we have to offset. Also setting a variable so we can set the desc prop to null
    const rowKeys = tableRows.length === 6 
        ? TABLE_ROW_KEYS.withDesc
        : TABLE_ROW_KEYS.withoutDesc;

    const hasDescription = tableRows.length === 6;

    let model = {};

    model.title = $(table).find('.Tableheader2').text().trim();

    model.description = hasDescription 
        ? tableRows.eq(rowKeys.description).children('td.SmallText').text()
        : null;
    
    const metaRow = tableRows.eq(rowKeys.meta_1);
    // const photoDate = luxon.DateTime.fromFormat(metaRow.children('td').eq(0).children('.homePageText').text().trim(), 'M/d/yyyy')
    
    const photoDate = luxon.DateTime.fromFormat(message.photoDate, 'D');
    model.photoDate = photoDate.toISODate();
    
    const uploadDate = luxon.DateTime.fromFormat(message.uploadDate, 'D tt'); 
    model.uploadDate = uploadDate.toISO();

    const locationCell = metaRow.children('td').eq(1);
    const locationLinkEle = locationCell.find('a').first();    
    const locationHrefRegex = /(?:[0-9]*)$/;

    model.location = {
        refId: locationHrefRegex.exec(locationLinkEle.attr('href'))[0],
        name: locationLinkEle.text()
    };

    const collectionOfCell = metaRow.children('td').eq(3);
    const collectionOfLinkEle = collectionOfCell.find('.homePageText').find('a');
    const collectionOfHrefRegex = /(?:http:\/\/)?(([^.]+)\.)?rrpicturearchives\.net/;

    model.collectionOf = {
        refId: collectionOfHrefRegex.exec(collectionOfLinkEle.attr('href'))[2],
        name: collectionOfLinkEle.html()
    }

    const metaRow2 = tableRows.eq(rowKeys.meta_2);
    const locomotivesElement = metaRow2.children().first().find('#spLocoInfo');
    const locomotiveLinks = locomotivesElement.find('a.Foot');

    model.locomotives = [];

    locomotiveLinks.each((idx, link) => {
        const linkHref = $(link).attr('href');
        const locoRefId = /(?:[0-9]*)$/.exec(linkHref)[0];

        const linkText = $(link).text();
        
        const locoDataRegex = /^([A-Z]{2,4}?\s[0-9]{1,4})\(([0-9A-Za-z\-\s]*)\)/
        const locoDataParts = locoDataRegex.exec(linkText);

        console.log(`Loco link text '${linkText}'`);

        const locomotive = {
            refId: locoRefId,
            reportingMarks: locoDataParts[1],
            model: locoDataParts[2]
        };

        model.locomotives.push(locomotive);
    });

    const authorElement = metaRow2.children().eq(1).find('.homePageText').first();    
    model.author = authorElement.text();

    const photoRow = tableRows.eq(rowKeys.photo);
    const photoElement = photoRow.children().first().find('img').first();
    model.imageFileUrl = photoElement.attr('src').replace(/\\/g, '/', );

    const categoryAlbumRow = tableRows.eq(rowKeys.categAlbum);
    const categoriesElement = categoryAlbumRow.children().eq(0);
    model.categories = categoriesElement.text().replace('Picture Categories: ', '').split(',').map(x => x.trim());

    const albumLinkElement = categoryAlbumRow.children().eq(1).find('a').first();
    const albumLinkHref = $(albumLinkElement).attr('href');
    const albumRefId = /(?:[0-9]*)$/.exec(albumLinkHref)[0];
    const albumLinkText = $(albumLinkElement).text();

    model.album = {
        refId: albumRefId,
        name: albumLinkText
    };

    return model;
};

(async () => {
    var sqsMessageParams = {
        AttributeNames: [
            "SentTimestamp"
        ],
        MaxNumberOfMessages: config.sqsMaxPollSize,
        MessageAttributeNames: [
            "All"
        ],
        QueueUrl: config.sqsQueueUrl,
        VisibilityTimeout: 20,
        WaitTimeSeconds: 10
    };

    sqs.receiveMessage(sqsMessageParams, async function(err, data) {
        if (err) {
            console.log('Receive message error', err)
        } else if (data.Messages) {
            for(const message of data.Messages) {
                const messageAttrs = {
                    url: message.MessageAttributes.ImageUrl.StringValue,
                    title: message.MessageAttributes.Title.StringValue,
                    photoDate: message.MessageAttributes.PhotoDate.StringValue,
                    uploadDate: message.MessageAttributes.UploadDate.StringValue
                };

                const photoModel = await getImageDetails(messageAttrs);
                console.log(`Image details retrieved from ${messageAttrs.url}. Attempting to import.`);
                
                try {
                    const importResponse = await axiosInstance.post('photos/import', photoModel);
                    console.log('Photo saved. Will be removed from queue.');
                    
                    const deleteMessageParams = {
                        QueueUrl: config.sqsQueueUrl,
                        ReceiptHandle: message.ReceiptHandle
                    };

                    sqs.deleteMessage(deleteMessageParams, function(err, data) {
                        if (err) {
                            console.log(`Error deleting message '${mes.ReceiptHandle}' from queue`, err);
                        }
                    });
                } catch(err) {
                    console.log('Save failed', err);
                }
            }
        }
    });
})();
