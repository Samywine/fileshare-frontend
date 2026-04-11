import React, { useEffect, useState } from 'react';
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute
} from 'amazon-cognito-identity-js';
import { v4 as uuidv4 } from 'uuid';
import awsConfig from './aws-config';

const userPool = new CognitoUserPool({
  UserPoolId: awsConfig.userPoolId,
  ClientId: awsConfig.userPoolClientId
});

function App() {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [user, setUser] = useState(null);
  const [jwtToken, setJwtToken] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [files, setFiles] = useState([]);
  const [comments, setComments] = useState({});
  const [commentInputs, setCommentInputs] = useState({});
  const [pendingConfirm, setPendingConfirm] = useState(false);

  useEffect(() => {
    const currentUser = userPool.getCurrentUser();
    if (currentUser) {
      currentUser.getSession((err, session) => {
        if (!err && session.isValid()) {
          setUser(currentUser);
          setJwtToken(session.getIdToken().getJwtToken());
          loadFiles(session.getIdToken().getJwtToken());
        }
      });
    }
  }, []);

  async function graphqlRequest(query, variables = {}, token = jwtToken) {
    const response = await fetch(awsConfig.graphqlEndpoint, {
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

  const signUp = () => {
    const attributeList = [
      new CognitoUserAttribute({
        Name: 'email',
        Value: email
      })
    ];

    userPool.signUp(email, password, attributeList, null, (err, result) => {
      if (err) {
        console.error(err);
        alert(err.message || 'Signup failed');
        return;
      }

      alert('✅ Account created. Check your email for confirmation code.');
      setPendingConfirm(true);
    });
  };

  const confirmSignUp = () => {
    const cognitoUser = new CognitoUser({
      Username: email,
      Pool: userPool
    });

    cognitoUser.confirmRegistration(confirmCode, true, (err, result) => {
      if (err) {
        console.error(err);
        alert(err.message || 'Confirmation failed');
        return;
      }

      alert('✅ Account confirmed. Now sign in.');
      setPendingConfirm(false);
      setMode('signin');
    });
  };

  const signIn = () => {
    const authenticationDetails = new AuthenticationDetails({
      Username: email,
      Password: password
    });

    const cognitoUser = new CognitoUser({
      Username: email,
      Pool: userPool
    });

    cognitoUser.authenticateUser(authenticationDetails, {
      onSuccess: (session) => {
        setUser(cognitoUser);
        const token = session.getIdToken().getJwtToken();
        setJwtToken(token);
        loadFiles(token);
      },
      onFailure: (err) => {
        console.error(err);
        alert(err.message || 'Sign in failed');
      }
    });
  };

  const signOut = () => {
    const currentUser = userPool.getCurrentUser();
    if (currentUser) currentUser.signOut();
    setUser(null);
    setJwtToken('');
    setFiles([]);
    setComments({});
  };

  const loadFiles = async (token = jwtToken) => {
    try {
      const data = await graphqlRequest(`
        query ListFiles {
          listFiles {
            fileId
            fileName
            version
            owner
            fileType
            fileSize
            s3Key
            createdAt
            updatedAt
          }
        }
      `, {}, token);

      setFiles(data.listFiles || []);
    } catch (err) {
      console.error("Load files error:", err);
    }
  };

  const uploadFile = async () => {
    if (!selectedFile || !jwtToken) {
      alert("Please choose a file first.");
      return;
    }

    try {
      // 1. Get pre-signed upload URL from AppSync -> Lambda
      const uploadData = await graphqlRequest(`
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

      const { uploadURL, key } = uploadData.getUploadUrl;

      // 2. Upload directly to S3
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

      // 3. Save metadata in DynamoDB via AppSync
      await graphqlRequest(`
        mutation CreateFileRecord(
          $fileName: String!,
          $fileSize: Int,
          $fileType: String,
          $s3Key: String!,
          $version: Int!
        ) {
          createFileRecord(
            fileName: $fileName,
            fileSize: $fileSize,
            fileType: $fileType,
            s3Key: $s3Key,
            version: $version
          ) {
            fileId
            fileName
            owner
            version
          }
        }
      `, {
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        fileType: selectedFile.type || "application/octet-stream",
        s3Key: key,
        version: 1
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
      const data = await graphqlRequest(`
        query GetComments($fileId: ID!) {
          getComments(fileId: $fileId) {
            commentId
            content
            createdAt
            fileId
            owner
          }
        }
      `, { fileId });

      setComments((prev) => ({
        ...prev,
        [fileId]: data.getComments || []
      }));
    } catch (err) {
      console.error("Load comments error:", err);
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
        mutation CreateComment($content: String!, $fileId: ID!) {
          createComment(content: $content, fileId: $fileId) {
            commentId
            content
            owner
            createdAt
            fileId
          }
        }
      `, {
        content,
        fileId
      });

      setCommentInputs((prev) => ({
        ...prev,
        [fileId]: ''
      }));

      loadComments(fileId);
    } catch (err) {
      console.error("Comment failed:", err);
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
                <p>
                  No account?{' '}
                  <button onClick={() => setMode('signup')}>Create one</button>
                </p>
              </>
            ) : (
              <>
                <button onClick={signUp}>Create Account</button>
                <p>
                  Already have an account?{' '}
                  <button onClick={() => setMode('signin')}>Sign in</button>
                </p>
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
        <button onClick={uploadFile} style={{ marginLeft: '10px' }}>
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
              padding: '12px',
              marginBottom: '15px',
              borderRadius: '8px'
            }}
          >
            <p><strong>Name:</strong> {file.fileName}</p>
            <p><strong>Owner:</strong> {file.owner}</p>
            <p><strong>Version:</strong> {file.version}</p>

            <button onClick={() => loadComments(file.fileId)}>
              Load Comments
            </button>

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
              <button
                onClick={() => addComment(file.fileId)}
                style={{ marginLeft: '10px' }}
              >
                Add Comment
              </button>
            </div>

            <div style={{ marginTop: '10px' }}>
              <strong>Comments:</strong>
              {(comments[file.fileId] || []).length === 0 ? (
                <p>No comments yet.</p>
              ) : (
                (comments[file.fileId] || []).map((comment) => (
                  <div key={comment.commentId}>
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

export default App;