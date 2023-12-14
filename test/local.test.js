import LocalUpload from "../src/local.js";
import {File} from '@web-std/file';
import fs from 'fs';

describe('LocalUpload', () => {
    it('should upload a file', async () => {
        const authToken = process.env.AUTH_TOKEN;
        const filePath = './test/test_files/test01.txt';
        const fStream = new fs.createReadStream(filePath, {highWaterMark: 32});

        global.fetch = jest.fn();
        global.fetch.mockImplementationOnce((endpoint, payload) =>{
            const msgPayload = JSON.parse(payload.body);
            console.log(msgPayload.checksum_value);
            expect(msgPayload.checksum_value).toEqual('d41d8cd98f00b204e9800998ecf8427e');
            return Promise.resolve({
                status: 200,
                json: () => Promise.resolve({
                    url: 'https://amz/upload/url',
                    fields: {
                        key: 'ef229725-1cad-485e-a72b-a276d2ca3175/35672b6e-caeb-46b9-a6e8-74599dc07163/848bd037-b09d-4f6b-9811-3bec1fde0f0b/ISS_LIS_SC_V2.2_20230620_185353_NRT.hdf',
                        AWSAccessKeyId: 'test',
                        policy: 'test',
                        signature: 'test',
                        'Content-Type': 'text/plain'
                    }
                })
            })
        })
        global.fetch.mockResolvedValueOnce({
            status: 204
        });

        const data = []
        let resp = null
        fStream.on('data', function (chunk){
            data.push(chunk);
        })
        fStream.on('end', function () {
            fStream.close();
        })
        fStream.on('close', function () {
            const fSize  = fs.promises.stat(filePath).then((stat)=>{return stat.size});
            const fileObj = new File(data, filePath.split('/').pop(), {type: 'text/plain', size: fSize})
            console.log("help");
            const upload = new LocalUpload();
            resp = upload.uploadFile(fileObj, "https://fake/upload/url", authToken, filePath)
        })
        expect(resp).toEqual('Upload successfull');
    });
});