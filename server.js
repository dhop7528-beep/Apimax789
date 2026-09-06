const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// API Lịch sử gốc mới
const EXTERNAL_API_URL = 'https://taixiumd5.maksh3979madfw.com/api/md5luckydice/GetSoiCau';

/**
 * Thuật toán phân tích lịch sử và đưa ra dự đoán SMART
 * Hỗ trợ cả định dạng mới (SessionId, BetSide, DiceSum) và định dạng cũ (id, resultTruyenThong)
 * @param {Array} historyList - Danh sách lịch sử phiên
 * @returns {Object} Kết quả phân tích và dự đoán
 */
function analyzeAndPredict(historyList) {
    if (!historyList || !Array.isArray(historyList) || historyList.length === 0) {
        return {
            phienHienTai: 0,
            phienDuDoan: 1,
            ketQuaGanNhat: "N/A",
            dicesGanNhat: [],
            diemGanNhat: 0,
            chuoiHienTai: "N/A",
            duDoan: "TAI",
            tyLeWin: "50%",
            phuongPhap: "Mặc định (Không có dữ liệu)"
        };
    }

    // Chuẩn hóa dữ liệu theo cấu trúc đồng nhất
    const normalizedList = historyList.map(item => {
        const id = item.SessionId || item.id || 0;
        
        // Xác định xúc xắc
        let dices = [];
        if (item.FirstDice !== undefined && item.SecondDice !== undefined && item.ThirdDice !== undefined) {
            dices = [item.FirstDice, item.SecondDice, item.ThirdDice];
        } else if (Array.isArray(item.dices)) {
            dices = item.dices;
        }

        // Xác định tổng điểm
        const point = item.DiceSum !== undefined ? item.DiceSum : (item.point || (dices.length === 3 ? dices[0] + dices[1] + dices[2] : 0));

        // Xác định kết quả TÀI hay XỈU (BetSide: 0 -> TAI, 1 -> XIU)
        let result = "TAI";
        if (item.BetSide !== undefined) {
            result = item.BetSide === 0 ? "TAI" : "XIU";
        } else if (item.resultTruyenThong) {
            result = item.resultTruyenThong.toUpperCase();
        } else {
            result = point > 10 ? "TAI" : "XIU";
        }

        return {
            id,
            dices,
            point,
            result
        };
    });

    // Sắp xếp lịch sử theo ID tăng dần để phân tích đúng thứ tự thời gian
    const sortedList = [...normalizedList].sort((a, b) => a.id - b.id);
    const totalSessions = sortedList.length;
    const latestSession = sortedList[totalSessions - 1];

    // Lấy chuỗi kết quả (T hoặc X)
    const results = sortedList.map(item => item.result === 'TAI' ? 'T' : 'X');

    // 1. Phân tích chuỗi lặp hiện tại (Streak) từ phiên gần nhất trở về trước
    let currentStreakType = results[results.length - 1];
    let currentStreakCount = 0;
    for (let i = results.length - 1; i >= 0; i--) {
        if (results[i] === currentStreakType) {
            currentStreakCount++;
        } else {
            break;
        }
    }

    // 2. Phân tích xu hướng 10 phiên gần nhất
    const last10 = results.slice(-10);
    const countT10 = last10.filter(r => r === 'T').length;
    const countX10 = last10.filter(r => r === 'X').length;

    let prediction = "";
    let method = "SMART Hybrid Engine";
    let baseConfidence = 65;

    // === QUY LUẬT 1: BỆT CẦU LỚN (≥4 phiên liên tiếp -> Bắt đảo chiều) ===
    if (currentStreakCount >= 4) {
        prediction = currentStreakType === 'T' ? 'XIU' : 'TAI';
        method = "Thuật toán Bệt Cầu (Đảo chiều chuỗi dài ≥4)";
        baseConfidence = 81;
    } 
    // === QUY LUẬT 2: CẦU 3 PHIÊN (Bắt đảo chiều) ===
    else if (currentStreakCount === 3) {
        prediction = currentStreakType === 'T' ? 'XIU' : 'TAI';
        method = "Thuật toán Đảo chiều (Cầu 3 phiên)";
        baseConfidence = 72;
    }
    // === QUY LUẬT 3: CHU KỲ NHỊP 1-1 (TX / XT) ===
    else if (totalSessions >= 3 && results[results.length - 1] !== results[results.length - 2] && results[results.length - 2] !== results[results.length - 3]) {
        // Đang đi cầu 1-1 (Ví dụ: T-X-T -> dự đoán X)
        prediction = currentStreakType === 'T' ? 'XIU' : 'TAI';
        method = "Thuật toán Chu kỳ (Cầu Nhịp 1-1)";
        baseConfidence = 68;
    }
    // === QUY LUẬT 4: DỰ ĐOÁN THEO XU HƯỚNG 10 PHIÊN GẦN NHẤT ===
    else {
        if (countT10 > countX10) {
            prediction = 'TAI';
            method = "Thuật toán Xu hướng (Đa số 10 phiên)";
            baseConfidence = 60;
        } else if (countX10 > countT10) {
            prediction = 'XIU';
            method = "Thuật toán Xu hướng (Đa số 10 phiên)";
            baseConfidence = 60;
        } else {
            // Cân bằng 5-5
            prediction = currentStreakType === 'T' ? 'XIU' : 'TAI';
            method = "Thuật toán Cân Bằng (Bắt cầu đảo)";
            baseConfidence = 55;
        }
    }

    // Tạo tỷ lệ ngẫu nhiên dao động từ 50% - 90%
    const randomOffset = Math.floor(Math.random() * 11) - 5; // -5% đến +5%
    let winRate = Math.min(90, Math.max(50, baseConfidence + randomOffset));

    return {
        phienHienTai: latestSession.id,
        phienDuDoan: latestSession.id + 1,
        ketQuaGanNhat: latestSession.result,
        dicesGanNhat: latestSession.dices,
        diemGanNhat: latestSession.point,
        chuoiHienTai: `${latestSession.result === 'TAI' ? 'TÀI' : 'XỈU'} x${currentStreakCount}`,
        duDoan: prediction,
        tyLeWin: `${winRate}%`,
        phuongPhap: method
    };
}

// Endpoint chính: Dự đoán phiên tiếp theo
app.get('/api/du-doan', async (req, res) => {
    try {
        const response = await axios.get(EXTERNAL_API_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*'
            },
            timeout: 7000
        });

        let rawData = response.data;
        let list = [];

        if (Array.isArray(rawData)) {
            list = rawData;
        } else if (rawData && Array.isArray(rawData.list)) {
            list = rawData.list;
        } else if (rawData && Array.isArray(rawData.data)) {
            list = rawData.data;
        } else {
            return res.status(500).json({
                status: "error",
                message: "Cấu trúc dữ liệu trả về từ API lịch sử không hợp lệ"
            });
        }

        const analysis = analyzeAndPredict(list);

        // Trả về dữ liệu dự đoán dưới dạng JSON thô
        return res.json({
            status: "success",
            data: {
                phien_hien_tai: analysis.phienHienTai,
                phien_du_doan: analysis.phienDuDoan,
                ket_qua_gan_nhat: analysis.ketQuaGanNhat,
                dices: analysis.dicesGanNhat,
                diem: analysis.diemGanNhat,
                chuoi_hien_tai: analysis.chuoiHienTai,
                du_doan: analysis.duDoan,
                ty_le_thang: analysis.tyLeWin,
                thuat_toan: analysis.phuongPhap,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error("Lỗi khi kết nối API gốc:", error.message);
        return res.status(500).json({
            status: "error",
            message: "Không thể kết nối đến máy chủ lịch sử",
            error: error.message
        });
    }
});

// Endpoint phụ: Xem dữ liệu thô từ API lịch sử gốc
app.get('/api/lich-su', async (req, res) => {
    try {
        const response = await axios.get(EXTERNAL_API_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 7000
        });
        return res.json(response.data);
    } catch (error) {
        return res.status(500).json({ error: "Lỗi kết nối API lịch sử", message: error.message });
    }
});

// Trang chủ hiển thị thông tin API
app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
            <h2>🤖 API DỰ ĐOÁN TÀI XỈU MD5 - SMART ENGINE</h2>
            <p>Trạng thái: <b style="color: green;">ĐANG HOẠT ĐỘNG</b></p>
            <p>API Lịch sử gốc: <code>${EXTERNAL_API_URL}</code></p>
            <ul>
                <li><b>Endpoint dự đoán:</b> <a href="/api/du-doan" target="_blank">/api/du-doan</a></li>
                <li><b>Endpoint lịch sử gốc:</b> <a href="/api/lich-su" target="_blank">/api/lich-su</a></li>
            </ul>
        </div>
    `);
});

app.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`Server dự đoán đang chạy tại port: ${PORT}`);
    console.log(`API Endpoint: http://localhost:${PORT}/api/du-doan`);
    console.log(`=================================`);
});
