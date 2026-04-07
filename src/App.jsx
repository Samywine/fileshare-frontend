import React, { useEffect, useState } from 'react';
import { Authenticator } from '@aws-amplify/ui-react';
import { API, Auth } from 'aws-amplify';
import { v4 as uuidv4 } from 'uuid';

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
    try {
      const currentUser = await Auth.currentAuthenticatedUser();
      setUser(currentUser);
    } catch (err) {
      console.error("User load error:", err);
    }
  };

  const loadFiles = async () => {
    try {
      const result = await API.graphql({
        query: `query ListFiles { listFiles { fileId fileName version owner } }`
      });
      setFiles(result.data.listFiles || []);
    } catch (err) {
      console.error("Load files error:", err);
    }
  };

  const uploadFile = async () => {
    if (!selectedFile || !user) return;
    alert("Upload starting, please wait...");

    try {
      const uploadResult = await API.graphql({
        query: `mutation GetUploadUrl($fileName: String!, $fileType: String!) {
          getUploadUrl(fileName: $fileName, fileType: $fileType) {
            uploadURL
            key
          }
        }`,
        variables: {
          fileName: selectedFile.name,
          fileType: selectedFile.type || "application/octet-stream"
        }
      });

      const { uploadURL, key } = uploadResult.data.getUploadUrl;

      const uploadResponse = await fetch(uploadURL, {
        method: 'PUT',
        headers: {
          'Content-Type': selectedFile.type || "application/octet-stream"
        },
        body: selectedFile
      });

      if (!uploadResponse.ok) {
        throw new Error("S3 upload failed");
      }

      await API.graphql({
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
            fileType: selectedFile.type || "application/octet-stream",
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

    } catch (err) {
      console.error("Upload failed:", err);
      alert("❌ Upload failed, please try again");
    }
  };

  const loadComments = async (fileId) => {
    try {
      const result = await API.graphql({
        query: `query GetComments($fileId: ID!) { getComments(fileId: $fileId) { commentId content owner createdAt } }`,
        variables: { fileId }
      });

      setComments(prev => ({
        ...prev,
        [fileId]: result.data.getComments || []
      }));
    } catch (err) {
      console.error(err);
    }
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

            <div className="row">
              <button onClick={() => loadComments(file.fileId)}>Load Comments</button>
            </div>

            <div className="row">
              <input
                type="text"
                placeholder="Write comment"
                value={commentInputs[file.fileId] || ''}
                onChange={(e) =>
                  setCommentInputs(prev => ({ ...prev, [file.fileId]: e.target.value }))
                }
              />
              <button>Add Comment</button>
            </div>

            <div className="commentsBox">
              <strong>Comments:</strong>
              {(comments[file.fileId] || []).map((c) => (
                <div key={c.commentId}>
                  {c.owner}: {c.content}
                </div>
              ))}
            </div>
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