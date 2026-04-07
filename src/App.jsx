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
        query: `
          query ListFiles {
            listFiles {
              fileId
              fileName
              version
              owner
            }
          }
        `
      });

      setFiles(result.data.listFiles || []);
    } catch (err) {
      console.error("Load files error:", err);
    }
  };

  const uploadFile = async () => {
    if (!selectedFile || !user) {
      alert("Please choose a file first.");
      return;
    }

    try {
      const uploadResult = await API.graphql({
        query: `
          mutation GetUploadUrl($fileName: String!, $fileType: String!) {
            getUploadUrl(fileName: $fileName, fileType: $fileType) {
              uploadURL
              key
            }
          }
        `,
        variables: {
          fileName: selectedFile.name,
          fileType: selectedFile.type || "application/octet-stream"
        }
      });

      const { uploadURL, key } = uploadResult.data.getUploadUrl;

      const s3UploadResponse = await fetch(uploadURL, {
        method: 'PUT',
        headers: {
          'Content-Type': selectedFile.type || "application/octet-stream"
        },
        body: selectedFile
      });

      if (!s3UploadResponse.ok) {
        throw new Error("S3 upload failed");
      }

      await API.graphql({
        query: `
          mutation CreateFile(
            $fileId: ID!,
            $fileName: String!,
            $s3Key: String!,
            $fileType: String,
            $fileSize: Int,
            $version: Int!,
            $owner: String!,
            $sharedWith: [String]
          ) {
            createFileRecord(
              fileId: $fileId,
              fileName: $fileName,
              s3Key: $s3Key,
              fileType: $fileType,
              fileSize: $fileSize,
              version: $version,
              owner: $owner,
              sharedWith: $sharedWith
            ) {
              fileId
              fileName
            }
          }
        `,
        variables: {
          fileId: uuidv4(),
          fileName: selectedFile.name,
          s3Key: key,
          fileType: selectedFile.type || "application/octet-stream",
          fileSize: selectedFile.size,
          version: 1,
          owner: user.username,
          sharedWith: []
        }
      });

      alert("✅ File uploaded successfully!");
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
        query: `
          query GetComments($fileId: ID!) {
            getComments(fileId: $fileId) {
              commentId
              content
              owner
              createdAt
            }
          }
        `,
        variables: { fileId }
      });

      setComments((prev) => ({
        ...prev,
        [fileId]: result.data.getComments || []
      }));
    } catch (err) {
      console.error("Load comments error:", err);
    }
  };

  const addComment = async (fileId) => {
    const content = commentInputs[fileId];

    if (!content || !content.trim()) {
      alert("Please type a comment first.");
      return;
    }

    try {
      await API.graphql({
        query: `
          mutation CreateComment(
            $commentId: ID!,
            $fileId: ID!,
            $content: String!,
            $owner: String!
          ) {
            createComment(
              commentId: $commentId,
              fileId: $fileId,
              content: $content,
              owner: $owner
            ) {
              commentId
              fileId
              content
              owner
              createdAt
            }
          }
        `,
        variables: {
          commentId: uuidv4(),
          fileId,
          content,
          owner: user.username
        }
      });

      setCommentInputs((prev) => ({
        ...prev,
        [fileId]: ''
      }));

      loadComments(fileId);
    } catch (err) {
      console.error("Create comment error:", err);
      alert("❌ Failed to add comment");
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Serverless File Sharing Platform</h1>

      <div style={{ marginBottom: '30px' }}>
        <h2>Upload New File</h2>
        <input
          type="file"
          onChange={(e) => setSelectedFile(e.target.files[0])}
        />
        <button
          onClick={uploadFile}
          style={{ marginLeft: '10px', padding: '8px 16px' }}
        >
          Upload File
        </button>
      </div>

      <div>
        <h2>Your Files</h2>
        {files.length === 0 && <p>No files uploaded yet.</p>}

        {files.map((file) => (
          <div
            key={file.fileId}
            style={{
              border: '1px solid #ccc',
              padding: '15px',
              marginBottom: '15px',
              borderRadius: '8px'
            }}
          >
            <p><strong>Name:</strong> {file.fileName}</p>
            <p><strong>Owner:</strong> {file.owner}</p>
            <p><strong>Version:</strong> {file.version}</p>

            <button
              onClick={() => loadComments(file.fileId)}
              style={{ marginBottom: '10px', padding: '6px 12px' }}
            >
              Load Comments
            </button>

            <div style={{ marginBottom: '10px' }}>
              <input
                type="text"
                placeholder="Write comment"
                value={commentInputs[file.fileId] || ''}
                onChange={(e) =>
                  setCommentInputs((prev) => ({
                    ...prev,
                    [file.fileId]: e.target.value
                  }))
                }
                style={{ marginRight: '10px', padding: '6px', width: '250px' }}
              />
              <button
                onClick={() => addComment(file.fileId)}
                style={{ padding: '6px 12px' }}
              >
                Add Comment
              </button>
            </div>

            <div>
              <strong>Comments:</strong>
              {(comments[file.fileId] || []).length === 0 ? (
                <p>No comments yet.</p>
              ) : (
                (comments[file.fileId] || []).map((comment) => (
                  <div key={comment.commentId} style={{ marginTop: '6px' }}>
                    {comment.owner}: {comment.content}
                  </div>
                ))
              )}
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