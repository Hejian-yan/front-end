const express = require("express");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

const app = express();
const PORT = 3000;

// ================================
// 1. 基础配置
// ================================

app.use(express.json());

// 让服务器可以访问当前项目里的 index.html、css、js 等文件
app.use(express.static(__dirname));


// ================================
// 2. 检查 API Key
// ================================

const API_KEY = process.env.DASHSCOPE_API_KEY;

if (!API_KEY) {
    console.error("=================================");
    console.error("错误：没有读取到 DASHSCOPE_API_KEY");
    console.error("请检查项目目录下是否存在 .env 文件");
    console.error("=================================");
} else {
    console.log("API Key 读取成功");
    console.log("Key 长度：" + API_KEY.length);
}


// ================================
// 3. AI 美食评价分析接口
// ================================

app.post("/api/ai-food-review", async (req, res) => {

    console.log("\n=================================");
    console.log("收到 AI 美食分析请求");
    console.log("=================================");

    try {

        // ----------------------------
        // 读取前端传来的数据
        // ----------------------------

        const food = req.body.food;
        const reviews = req.body.reviews;

        console.log("美食：", food);
        console.log("评价数量：", Array.isArray(reviews) ? reviews.length : 0);


        // ----------------------------
        // 检查数据
        // ----------------------------

        if (!food) {
            return res.status(400).json({
                success: false,
                error: "没有传入美食信息"
            });
        }

        if (!Array.isArray(reviews) || reviews.length === 0) {
            return res.status(400).json({
                success: false,
                error: "没有评价数据"
            });
        }

        if (!API_KEY) {
            return res.status(500).json({
                success: false,
                error: "服务器没有读取到 DASHSCOPE_API_KEY"
            });
        }


        // ================================
        // 4. 整理用户评价
        // ================================

        const reviewText = reviews
            .map((item, index) => {

                // 兼容不同字段名称
                let text =
                    item.text ||
                    item.content ||
                    item.review ||
                    item.comment ||
                    "";

                return `${index + 1}. ${text}`;
            })
            .join("\n");


        // ================================
        // 5. 构造 Prompt
        // ================================

        const prompt = `
你现在是一名专业的美食评价分析助手。

请根据用户提供的美食信息和真实用户评价，进行客观分析。

【美食信息】
名称：${food.name || ""}
地址：${food.address || ""}
分类：${food.category || ""}
价格：${food.price || ""}
评分：${food.rating || ""}

【用户评价】
${reviewText}

请分析这些评价，并严格返回 JSON。

JSON 格式必须是：

{
  "summary": "对这家美食整体评价的总结",
  "advantages": [
    "优点1",
    "优点2",
    "优点3"
  ],
  "disadvantages": [
    "缺点1",
    "缺点2",
    "缺点3"
  ],
  "tags": [
    "标签1",
    "标签2",
    "标签3"
  ]
}

要求：

1. summary 必须是字符串。
2. advantages 必须是字符串数组。
3. disadvantages 必须是字符串数组。
4. tags 必须是字符串数组。
5. 必须根据用户评价进行分析。
6. 不要编造评价中完全不存在的内容。
7. 不要输出 Markdown。
8. 不要输出代码块。
9. 只返回 JSON。
`;


        // ================================
        // 6. 调用阿里云百炼
        // ================================

        // 中国大陆：
        // 华北2（北京）
        //
        // 这里使用北京地域的 DashScope Endpoint
        //
        const apiUrl =
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";


        console.log("正在请求阿里云百炼...");
        console.log("模型：qwen-plus");
        console.log("地域：华北2（北京）");


        const response = await fetch(apiUrl, {

            method: "POST",

            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json"
            },

            body: JSON.stringify({

                model: "qwen-plus",

                messages: [
                    {
                        role: "system",
                        content: "你是一名专业、客观的美食评价分析助手。"
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],

                temperature: 0.3

            })

        });


        // ================================
        // 7. 获取阿里云原始返回
        // ================================

        const responseText = await response.text();

        console.log("阿里云 HTTP 状态码：", response.status);


        // ----------------------------
        // 如果 HTTP 请求失败
        // ----------------------------

        if (!response.ok) {

            console.error("阿里云 API 请求失败：");
            console.error(responseText);

            return res.status(response.status).json({
                success: false,
                error: "阿里云 AI 请求失败",
                status: response.status,
                detail: responseText
            });
        }


        // ================================
        // 8. 解析阿里云返回
        // ================================

        let result;

        try {

            result = JSON.parse(responseText);

        } catch (error) {

            console.error("阿里云返回的数据不是合法 JSON：");
            console.error(responseText);

            return res.status(500).json({
                success: false,
                error: "阿里云返回格式错误",
                detail: responseText
            });
        }


        // ================================
        // 9. 获取模型真正输出的内容
        // ================================

        let content =
            result?.choices?.[0]?.message?.content;


        if (!content) {

            console.error("没有找到 AI 返回内容：");
            console.error(JSON.stringify(result, null, 2));

            return res.status(500).json({
                success: false,
                error: "AI 没有返回有效内容",
                detail: result
            });
        }


        console.log("\nAI 原始回答：");
        console.log(content);


        // ================================
        // 10. 清理可能出现的 Markdown
        // ================================

        content = content.trim();

        // 去掉 ```json
        content = content.replace(/^```json\s*/i, "");

        // 去掉 ```
        content = content.replace(/^```\s*/i, "");
        content = content.replace(/\s*```$/i, "");

        content = content.trim();


        // ================================
        // 11. 解析 AI 返回的 JSON
        // ================================

        let aiData;

        try {

            aiData = JSON.parse(content);

        } catch (error) {

            console.error("AI 返回的内容不是 JSON：");
            console.error(content);

            // 尝试从内容中截取 JSON
            const start = content.indexOf("{");
            const end = content.lastIndexOf("}");

            if (start !== -1 && end !== -1 && end > start) {

                const jsonText =
                    content.substring(start, end + 1);

                try {

                    aiData = JSON.parse(jsonText);

                } catch (error2) {

                    console.error("第二次 JSON 解析也失败");

                    return res.status(500).json({
                        success: false,
                        error: "AI 返回格式无法解析",
                        raw: content
                    });
                }

            } else {

                return res.status(500).json({
                    success: false,
                    error: "AI 返回内容中没有找到 JSON",
                    raw: content
                });
            }
        }


        // ================================
        // 12. 检查字段
        // ================================

        const finalData = {

            summary:
                typeof aiData.summary === "string"
                    ? aiData.summary
                    : "",

            advantages:
                Array.isArray(aiData.advantages)
                    ? aiData.advantages
                    : [],

            disadvantages:
                Array.isArray(aiData.disadvantages)
                    ? aiData.disadvantages
                    : [],

            tags:
                Array.isArray(aiData.tags)
                    ? aiData.tags
                    : []

        };


        // ================================
        // 13. 返回给前端
        // ================================

        console.log("\nAI 分析完成");

        console.log(JSON.stringify(finalData, null, 2));

        console.log("=================================\n");


        return res.json({

            success: true,

            data: {

                foodId: food.id,

                foodName: food.name,

                summary: finalData.summary,

                advantages: finalData.advantages,

                disadvantages: finalData.disadvantages,

                tags: finalData.tags

            }

        });


    } catch (error) {

        console.error("\n服务器发生异常：");
        console.error(error);

        return res.status(500).json({

            success: false,

            error: "服务器内部错误",

            detail: error.message

        });

    }

});


// ================================
// 14. 启动服务器
// ================================

app.listen(PORT, () => {

    console.log("=================================");
    console.log("焦糖美食指南服务器启动成功");
    console.log(`http://localhost:${PORT}`);
    console.log("AI：阿里云百炼");
    console.log("地域：华北2（北京）");
    console.log("模型：qwen-plus");
    console.log("=================================");

});