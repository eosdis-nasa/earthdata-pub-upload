const LocalUpload = require('../src/local.js');

const webStdFile = require('@web-std/file');
const File = webStdFile.File;

const fs = require('fs');

describe('LocalUpload', () => {
    it('should upload a file', async () => {
        const authToken = process.env.AUTH_TOKEN;
        const filePath = './test/test_files/test01.txt';

        global.fetch = jest.fn();
        global.fetch.mockImplementationOnce((endpoint, payload) =>{
            const msgPayload = JSON.parse(payload.body);
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
        global.fetch.mockImplementationOnce((endpoint, payload) =>{
            return Promise.resolve({status: 204})
        })
        global.FileReader = jest.fn().mockImplementation(() => {
            return {
                readAsArrayBuffer: jest.fn(),
                readAsDataURL: jest.fn(),
                onload: jest.fn(),
                onerror: jest.fn(),
            };
        });
        const mockGenerateHash = jest.spyOn(LocalUpload.prototype, 'generateHash');
        mockGenerateHash.mockResolvedValueOnce('d41d8cd98f00b204e9800998ecf8427e');

        const uploadResp = await new Promise((resolve, reject) => {
            const fStream = new fs.createReadStream(filePath, {highWaterMark: 32});
            const data = []
            var resp = null
            fStream.on('data', function (chunk){
                data.push(chunk);
            })
            fStream.on('end', function () {
                fStream.close();
            })
            return fStream.on('close', async function () {
                const fSize  = fs.promises.stat(filePath).then((stat)=>{return stat.size});
                const fileObj = new File(data, filePath.split('/').pop(), {type: 'text/plain', size: fSize})
                const upload = new LocalUpload();
                resp = await upload.uploadFile({fileObj, api_endpoint:"https://fake/upload/url", authToken, fPath:filePath})
                console.log(resp);  
                resolve(resp);   
            })
        });

        expect(uploadResp).toEqual('Upload successfull');
    });
});