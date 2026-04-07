import React, { useEffect, useState } from 'react';
import { Auth } from 'aws-amplify';
import { v4 as uuidv4 } from 'uuid';
import awsConfig from './aws-config';

const GRAPHQL_ENDPOINT = awsConfig.aws_appsync_graphqlEndpoint;

async function graphqlRequest(query, variables = {}) {
  const session = await Auth.currentSession();
  const token = session.getIdToken().getJwtToken();

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token
    },
    body: JSON.stringify({
      query,
      variables
    })
  });

  const result = await response.json();

  if (result.errors) {
    console.error('GraphQL errors:', result.errors);
    throw new Error(result.errors[0].message || 'GraphQL request failed');
  }

  return result.data;
}

function App() {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [user, setUser] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [files, setFiles] = useState([]);
  const [comments, setComments] = useState({});
  const [commentInputs, setCommentInputs] = useState({});
  const [pendingConfirm, setPendingConfirm] = useState(false);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const currentUser = await Auth.currentAuthenticatedUser();
      setUser(currentUser);
      loadFiles();
    } catch {
      setUser(null);
    }
  };

  const signUp = async () => {
    try {
      await Auth.signUp({
        username: email,
        password,
        attributes: { email }
      });
      alert('✅ Account created. Check your email for confirmation code.');
      setPendingConfirm(true);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Signup failed');
    }
  };

  const confirmSignUp = async () => {
    try {
      await Auth.confirmSignUp(email, confirmCode);
      alert('✅ Account confirmed. Now sign in.');
      setPendingConfirm(false);
      setMode('signin');
    } catch (err) {
      console.error(err);
      alert(err.message || 'Confirmation failed');
    }
  };

  const signIn = async () => {
    try {
      const signedInUser = await Auth.signIn(email, password);
      setUser(signedInUser);
      loadFiles();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Sign in failed');
    }
  };

  const signOut = async () => {
    await Auth.signOut();
    setUser(null);
    setFiles([]);
  };

  const loadFiles = async () => {
    try {
      const data = await graphqlRequest(`
        query ListFiles {
          listFiles {
            fileId
            fileName
            version
            owner
          }
        }
      `);

      setFiles(data.listFiles || []);
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
      const data = await graphqlRequest(`
        mutation GetUploadUrl($fileName: String!, $fileType: String!) {
          getUploadUrl(fileName: $fileName, fileType: $fileType) {
            uploadURL
            key
          }
        }
      `, {
        fileName: selectedFile.name,
        fileType: selectedFile.type || "application/octet-stream"
      });

      const { uploadURL, key } = data.getUploadUrl;

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

      await graphqlRequest(`
        mutation CreateFileRecord(
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
      `, {
        fileId: uuidv4(),
        fileName: selectedFile.name,
        s3Key: key,
        fileType: selectedFile.type || "application/octet-stream",
        fileSize: selectedFile.size,
        version: 1,
        owner: user.username,
        sharedWith: []
      });

      alert("✅ File uploaded successfully!");
      loadFiles();
    } catch (err) {
      console.error("Upload failed:", err);
      alert("❌ Upload failed, please try again");
    }
  };

  const loadComments = async (fileId) => {
    try {
      const data = await graphqlRequest(`
        query GetComments($fileId: ID!) {
          getComments(fileId: $fileId) {
            commentId
            content
            owner
            createdAt
          }
        }
      `, { fileId });

      setComments((prev) => ({
        ...prev,
        [fileId]: data.getComments || []
      }));
    } catch (err) {
      console.error(err);
    }
  };

  const addComment = async (fileId) => {
    const content = commentInputs[fileId];
    if (!content || !content.trim()) {
      alert("Please type a comment");
      return;
    }

    try {
      await graphqlRequest(`
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
          }
        }
      `, {
        commentId: uuidv4(),
        fileId,
        content,
        owner: user.username
      });

      setCommentInputs((prev) => ({
        ...prev,
        [fileId]: ''
      }));

      loadComments(fileId);
    } catch (err) {
      console.error(err);
      alert("❌ Comment failed");
    }
  };

  if (!user) {
    return (
      <div style={{ padding: '20px', fontFamily: 'Arial' }}>
        <h1>Serverless File Sharing Platform</h1>

        {!pendingConfirm ? (
          <>
            <h2>{mode === 'signin' ? 'Sign In' : 'Create Account'}</h2>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ display: 'block', marginBottom: '10px', padding: '8px', width: '300px' }}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ display: 'block', marginBottom: '10px', padding: '8px', width: '300px' }}
            />

            {mode === 'signin' ? (
              <>
                <button onClick={signIn}>Sign In</button>
                <p>No account? <button onClick={() => setMode('signup')}>Create one</button></p>
              </>
            ) : (
              <>
                <button onClick={signUp}>Create Account</button>
                <p>Already have an account? <button onClick={() => setMode('signin')}>Sign in</button></p>
              </>
            )}
          </>
        ) : (
          <>
            <h2>Confirm Account</h2>
            <input
              type="text"
              placeholder="Confirmation code"
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value)}
              style={{ display: 'block', marginBottom: '10px', padding: '8px', width: '300px' }}
            />
            <button onClick={confirmSignUp}>Confirm</button>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial' }}>
      <h1>Serverless File Sharing Platform</h1>
      <button onClick={signOut}>Sign Out</button>

      <div style={{ marginTop: '20px', marginBottom: '30px' }}>
        <h2>Upload New File</h2>
        <input type="file" onChange={(e) => setSelectedFile(e.target.files[0])} />
        <button onClick={uploadFile} style={{ marginLeft: '10px' }}>Upload File</button>
      </div>

      <div>
        <h2>Your Files</h2>
        {files.length === 0 && <p>No files uploaded yet.</p>}

        {files.map((file) => (
          <div key={file.fileId} style={{ border: '1px solid #ccc', padding: '12px', marginBottom: '15px' }}>
            <p><strong>Name:</strong> {file.fileName}</p>
            <p><strong>Owner:</strong> {file.owner}</p>
            <p><strong>Version:</strong> {file.version}</p>

            <button onClick={() => loadComments(file.fileId)}>Load Comments</button>

            <div style={{ marginTop: '10px' }}>
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
              />
              <button onClick={() => addComment(file.fileId)} style={{ marginLeft: '10px' }}>
                Add Comment
              </button>
            </div>

            <div style={{ marginTop: '10px' }}>
              <strong>Comments:</strong>
              {(comments[file.fileId] || []).map((comment) => (
                <div key={comment.commentId}>
                  {comment.owner}: {comment.content}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;