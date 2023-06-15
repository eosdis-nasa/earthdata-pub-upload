import LocalUpload from "../src/local.js";
import {File} from '@web-std/file'
import fs from 'fs';

const authToken = process.env.AUTH_TOKEN;
const filePath = './test/test_files/test01.txt';
const fStream = new fs.createReadStream(filePath, {highWaterMark: 32});

const data = []
fStream.on('data', function (chunk){
    data.push(chunk);
})
fStream.on('end', function () {
    fStream.close();
})
fStream.on('close', function () {
    const fSize  = fs.promises.stat(filePath).then((stat)=>{return stat.size});
    const fileObj = new File(data, filePath.split('/').pop(), {type: 'text/plain', size: fSize})
    const upload = new LocalUpload();
    upload.uploadFile(fileObj, "https://pub.sit.earthdata.nasa.gov/api/data/upload/getPutUrl", authToken, filePath)
})