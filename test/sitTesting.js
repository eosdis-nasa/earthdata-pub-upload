import LocalUpload from "../src/local.js";
import {File} from '@web-std/file'
import fs from 'fs';

const authToken = process.env.AUTH_TOKEN;
const filePath = './test/test_files/test01.txt';
const fStream = new fs.createReadStream(filePath, {highWaterMark: 32});
const key = 'ef229725-1cad-485e-a72b-a276d2ca3175/35672b6e-caeb-46b9-a6e8-74599dc07163/848bd037-b09d-4f6b-9811-3bec1fde0f0b/ISS_LIS_SC_V2.2_20230620_185353_NRT.hdf'

// const data = []
// fStream.on('data', function (chunk){
//     data.push(chunk);
// })
// fStream.on('end', function () {
//     fStream.close();
// })
// fStream.on('close', function () {
//     const fSize  = fs.promises.stat(filePath).then((stat)=>{return stat.size});
//     const fileObj = new File(data, filePath.split('/').pop(), {type: 'text/plain', size: fSize})
//     const upload = new LocalUpload();
//     upload.uploadFile(fileObj, "https://pub.sit.earthdata.nasa.gov/api/data/upload/getPutUrl", authToken, filePath)
// })

const download = new LocalUpload();
const resp = download.downloadFile(key, 'https://pub.sit.earthdata.nasa.gov/api/data/upload/downloadUrl', authToken)
