require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const Torrent = require('./models/Torrent');
const axios = require('axios');

const app = express();

// Koneksi ke MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Terhubung ke MongoDB'))
    .catch(err => console.error('Error koneksi MongoDB:', err));

// Fungsi untuk mengecek URL
async function checkUrl(url) {
    try {
        const response = await axios.head(url);
        return response.status === 200;
    } catch (error) {
        return false;
    }
}

// Route untuk menangani request stream
app.get('/stream', async (req, res) => {
    try {
        const { link, index, play } = req.query;

        if (!link) {
            return res.status(400).json({ error: 'Parameter link diperlukan' });
        }

        // Cari torrent berdasarkan infoHash
        const torrent = await Torrent.findOne({
            infoHash: link.toLocaleLowerCase(),
            completed: true
        });

        if ('preload' in req.query) {
            if (torrent) {
                // Jika torrent ditemukan dan complete, return JSON data
                return res.json({
                    status: 'success',
                    message: 'File sudah tersedia',
                    data: {
                        infoHash: torrent.infoHash,
                        fileName: torrent.fileName,
                        filePath: torrent.filePath,
                        name: torrent.name,
                        completed: torrent.completed,
                        createdAt: torrent.createdAt
                    }
                });
            }
            // Jika tidak ditemukan, redirect ke fando
            return res.redirect(`https://fando.lovelywombat.box.ca/stream?link=${link}&index=1&preload`);
        }

        if ('m3u' in req.query) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Content-Disposition', 'attachment; filename="playlist.m3u"');
            return res.send(`#EXTM3U
#EXTINF:0,${'video'}
https://stream.fando.id/stream/video?link=${link}&index=1&play`);
        }

        if (!torrent) {
            // Redirect ke fando.lovelywombat.box.ca jika torrent tidak ditemukan atau belum complete
            const fandoUrl = `https://fando.lovelywombat.box.ca/stream?link=${link}&index=1&play`;
            return res.redirect(fandoUrl);
        }

        // Coba URL dengan filepath terlebih dahulu
        const urlWithPath = `https://nginx.lovelywombat.box.ca/${torrent.filePath}/${torrent.fileName}`;
        const isUrlWithPathValid = await checkUrl(urlWithPath);

        if (isUrlWithPathValid) {
            return res.redirect(urlWithPath);
        }

        // Jika URL dengan path tidak valid, coba URL tanpa path
        const urlWithoutPath = `https://nginx.lovelywombat.box.ca/${torrent.fileName}`;
        const isUrlWithoutPathValid = await checkUrl(urlWithoutPath);

        if (isUrlWithoutPathValid) {
            return res.redirect(urlWithoutPath);
        }

        // Jika kedua URL tidak valid, redirect ke fando
        const fandoUrl = `https://fando.lovelywombat.box.ca/stream?link=${link}&index=1&play`;
        return res.redirect(fandoUrl);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Terjadi kesalahan server' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
}); 