#!/bin/bash

# 測試 API 的腳本

echo "=== 測試 PDF 摘要 API ==="
echo ""

# 建立測試文本（使用 jq 正確轉義）
TEST_TEXT="介紹：現代人工智能系統已經成為各個領域的重要工具。\n\n方法論：本研究採用了多種技術來解決問題。\n\n結果：實驗結果表明我們的方法取得了良好的性能。\n\n結論：本論文提出了改進人工智能系統的新方法。"

# 使用 Node.js 來生成正確的 JSON
RESPONSE=$(node -e "
const payload = {
  text: 'Introduction: Modern AI systems are important tools. Methods: We used multiple techniques. Results: Good performance achieved. Conclusion: New methods proposed.',
  fileName: 'test-document.pdf',
  metadata: {
    title: 'AI Research Paper',
    author: 'Test User',
    subject: 'Machine Learning'
  },
  options: {
    language: 'zh',
    summaryStyle: 'outline'
  }
};

const https = require('http');
const options = {
  hostname: 'localhost',
  port: 8787,
  path: '/api/summarize',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => { console.log(data); });
});

req.on('error', (e) => { console.error('Error:', e.message); });
req.write(JSON.stringify(payload));
req.end();
" 2>&1)

echo "📤 發送請求到 /api/summarize..."
echo ""
echo "✅ 響應："
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"

echo ""
echo "=== 測試完成 ==="
