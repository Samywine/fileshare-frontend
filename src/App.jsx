import React, { useEffect, useState } from 'react';
import { Authenticator } from '@aws-amplify/ui-react';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser } from 'aws-amplify/auth';
import { v4 as uuidv4 } from 'uuid';

const client = generateClient();

function MainApp() {
  const [user, setUser] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [files, setFiles] = useState([]);
  const [comments, setComments] = useState({});
  const [commentInputs, setCommentInputs] = useState({});

  useEffect(() => {
    loadUser();
    loadFiles();
  }, []);

  const loadUser = async () => {
    const currentUser = await getCurrentUser();
    setUser(currentUser);
  };

  const loadFiles = async () => {
    const result = await client.graphql({
      query: `query ListFiles { listFiles { fileId fileName version owner } }`
    });
    setFiles(result.data.listFiles || []);
  };

  const uploadFile = async () => {
    if (!selectedFile || !user) return;

    const uploadResult = await client.graphql({
      query: `mutation GetUploadUrl($fileName: String!, $fileType: String!) {
        getUploadUrl(fileName: $fileName, fileType: $fileType) {
          uploadURL
          key
        }
      }`,
      variables: {
        fileName: selectedFile.name,
        fileType: selectedFile.type
      }
    });

    const { uploadURL, key } = uploadResult.data.getUploadUrl;

    await fetch(uploadURL, {
      method: 'PUT',
      headers: {
        'Content-Type': selectedFile.type
      },
      body: selectedFile
    });

    await client.graphql({
      query: `mutation CreateFile($input: FileRecordInput!) {
        createFileRecord(input: $input) {
          fileId
          fileName
        }
      }`,
      variables: {
        input: {
          fileId: uuidv4(),
          fileName: selectedFile.name,
          s3Key: key,
          fileType: selectedFile.type,
          fileSize: selectedFile.size,
          version: 1,
          owner: user.username,
          sharedWith: []
        }
      }
    });

    alert('✅ File uploaded successfully!');
    setSelectedFile(null);
    loadFiles();
  };

  return (
    <div className="container">
      <h1>Serverless File Sharing Platform</h1>

      <div className="card">
        <h2>Upload New File</h2>
        <input type="file" onChange={(e) => setSelectedFile(e.target.files[0])} />
        <button onClick={uploadFile}>Upload File</button>
      </div>

      <div className="card">
        <h2>Your Files</h2>
        {files.map((file) => (
          <div key={file.fileId} className="fileCard">
            <p><strong>Name:</strong> {file.fileName}</p>
            <p><strong>Owner:</strong> {file.owner}</p>
            <p><strong>Version:</strong> {file.version}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Authenticator>
      <MainApp />
    </Authenticator>
  );
}