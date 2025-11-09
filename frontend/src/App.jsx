import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [step, setStep] = useState(1);
  const [credentials, setCredentials] = useState({
    appId: '',
    apiHash: '',
    phone: ''
  });
  const [verification, setVerification] = useState({
    code: '',
    phoneCodeHash: '',
    appId: '',
    apiHash: '',
    phone: ''
  });
  const [stringSession, setStringSession] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [floodWaitSeconds, setFloodWaitSeconds] = useState(0);

  // 计算剩余等待时间的函数
  const getRemainingTime = () => {
    if (floodWaitSeconds <= 0) return '';
    const minutes = Math.ceil(floodWaitSeconds / 60);
    return `请在 ${minutes} 分钟后重试`;
  };

  // 定时器，用于倒计时
  useEffect(() => {
    let timer;
    if (floodWaitSeconds > 0) {
      timer = setInterval(() => {
        setFloodWaitSeconds(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [floodWaitSeconds]);

  const handleCredentialsSubmit = async (e) => {
    e.preventDefault();
    // 如果还在等待期，不执行任何操作
    if (floodWaitSeconds > 0) {
      return;
    }
    
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/generate-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials)
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setVerification({
          ...verification,
          phoneCodeHash: data.phoneCodeHash,
          appId: credentials.appId,
          apiHash: credentials.apiHash,
          phone: credentials.phone
        });
        setStep(2);
      } else {
        setError(data.error || 'Failed to send code');
        // 如果是 FloodWaitError，设置等待时间
        if (data.floodWaitSeconds) {
          setFloodWaitSeconds(data.floodWaitSeconds);
        }
      }
    } catch (err) {
      setError('Network error: ' + err.message);
    } finally {
      // 确保在任何情况下都重置 loading 状态
      setLoading(false);
    }
  };

  const handleVerificationSubmit = async (e) => {
    e.preventDefault();
    // 如果还在等待期，不执行任何操作
    if (floodWaitSeconds > 0) {
      return;
    }
    
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/verify-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appId: verification.appId,
          apiHash: verification.apiHash,
          phone: verification.phone,
          phoneCodeHash: verification.phoneCodeHash,
          code: verification.code
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setStringSession(data.stringSession);
        setStep(3);
      } else {
        setError(data.error || 'Failed to verify code');
        // 如果是 FloodWaitError，设置等待时间
        if (data.floodWaitSeconds) {
          setFloodWaitSeconds(data.floodWaitSeconds);
        }
        // 如果后端重新发送了验证码，更新 phoneCodeHash
        if (data.newPhoneCodeHash) {
          setVerification(prev => ({
            ...prev,
            phoneCodeHash: data.newPhoneCodeHash
          }));
        }
      }
    } catch (err) {
      setError('Network error: ' + err.message);
    } finally {
      // 确保在任何情况下都重置 loading 状态
      setLoading(false);
    }
  };

  const handleCredentialsChange = (e) => {
    setCredentials({
      ...credentials,
      [e.target.name]: e.target.value
    });
  };

  const handleVerificationChange = (e) => {
    setVerification({
      ...verification,
      [e.target.name]: e.target.value
    });
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(stringSession);
    alert('String Session copied to clipboard!');
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Telegram Session Generator</h1>
      </header>

      <main className="app-main">
        {error && (
          <div className="error-message">
            {error}
          </div>
        )}
        
        {floodWaitSeconds > 0 && (
          <div className="flood-wait-message">
            请求过于频繁，{getRemainingTime()}
          </div>
        )}

        {step === 1 && (
          <div>
            <p className="disclaimer">
              声明：您输入的所有信息均不会被保存，请放心使用。
            </p>
            <div className="step">
              <h2>Step 1: Enter Credentials</h2>
              <form onSubmit={(e) => {
                e.preventDefault();
                handleCredentialsSubmit(e);
              }}>
                <div className="form-group">
                  <label htmlFor="appId">API ID:</label>
                  <input
                    type="text"
                    id="appId"
                    name="appId"
                    value={credentials.appId}
                    onChange={handleCredentialsChange}
                    required
                    disabled={loading || floodWaitSeconds > 0}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="apiHash">API Hash:</label>
                  <input
                    type="text"
                    id="apiHash"
                    name="apiHash"
                    value={credentials.apiHash}
                    onChange={handleCredentialsChange}
                    required
                    disabled={loading || floodWaitSeconds > 0}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="phone">Phone Number(Includes country code):</label>
                  <input
                    type="text"
                    id="phone"
                    name="phone"
                    value={credentials.phone}
                    onChange={handleCredentialsChange}
                    required
                    placeholder="+1234567890"
                    disabled={loading || floodWaitSeconds > 0}
                  />
                </div>

                <button type="submit" disabled={loading || floodWaitSeconds > 0}>
                  {loading ? 'Sending...' : floodWaitSeconds > 0 ? getRemainingTime() : 'Send Code'}
                </button>
              </form>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="step">
            <h2>Step 2: Enter Verification Code</h2>
            <p className="info-message">
              请输入您在 Telegram 应用中收到的验证码。如果您没有收到验证码或验证码已过期，请返回上一步重新发送。
            </p>
            <form onSubmit={(e) => {
              e.preventDefault();
              handleVerificationSubmit(e);
            }}>
              <div className="form-group">
                <label htmlFor="code">Verification Code:</label>
                <input
                  type="text"
                  id="code"
                  name="code"
                  value={verification.code}
                  onChange={handleVerificationChange}
                  required
                  disabled={loading || floodWaitSeconds > 0}
                />
              </div>

              <button type="submit" disabled={loading || floodWaitSeconds > 0}>
                {loading ? 'Verifying...' : floodWaitSeconds > 0 ? getRemainingTime() : 'Verify Code'}
              </button>
              <button type="button" onClick={() => setStep(1)} disabled={loading || floodWaitSeconds > 0}>
                重新发送验证码
              </button>
            </form>
          </div>
        )}

        {step === 3 && (
          <div className="step">
            <h2>Step 3: Session Generated</h2>
            <div className="session-result">
              <p>Your Session:</p>
              <div className="session-display">
                {stringSession}
              </div>
              <button onClick={copyToClipboard}>
                Copy to Clipboard
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;