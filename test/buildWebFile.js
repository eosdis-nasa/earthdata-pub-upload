import superFs  from '@supercharge/fs'
import fs from 'fs';
import {File} from '@web-std/file'

async function makeFile(fPath){
    const fSize  = await superFs.size(fPath);
    console.log(fSize);
    const data = []
    const readStream = new fs.createReadStream(fPath, {highWaterMark: 32});
    readStream.on('data', function (chunk){
        data.push(chunk);
    });
    readStream.on('end', function () {
        console.log(data);
        const fileObj = new File(data, fPath.split('/').pop(), {type: 'text/plain', size: fSize});
        console.log(fileObj);
        return fileObj;
    });
    readStream.on('error', (err)=>{
        console.log(err);
    });
    console.log("here");

}

export default makeFile;