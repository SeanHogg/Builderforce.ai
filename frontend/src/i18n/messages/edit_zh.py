import json
import sys

with open('zh.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Find where noticeFormFailed is
found = False
for key in data:
    if isinstance(data[key], dict):
        if 'noticeFormFailed' in data[key]:
            print(f"Found noticeFormFailed in namespace: {key}", file=sys.stderr)
            # Add the new keys to that namespace
            data[key]['noticeFormSent'] = '表单已发送给 {queued} 位收件人。'
            data[key]['noticeFormPosted'] = '表单已发布到 {published} 个渠道。'
            data[key]['noticeFormNoAudience'] = '发送需要受众——添加收件人以或选择营销受众。'
            data[key]['noticeFormBlocked'] = '无法发送：{blockers}。修复后再试。'
            data[key]['sendFailed'] = '无法发送表单。'
            data[key]['postFailed'] = '无法发布表单。'
            found = True

if found:
    with open('zh.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    print("Keys added successfully")
else:
    print("noticeFormFailed not found!", file=sys.stderr)