require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const Torrent = require('./models/Torrent');
const axios = require('axios');
const stringSimilarity = require('string-similarity');

const app = express();

// Koneksi ke MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Terhubung ke MongoDB'))
    .catch(err => console.error('Error koneksi MongoDB:', err));

let client = null;

// Fungsi untuk mendapatkan info torrent dari infoHash
async function getTorrentInfo(infoHash) {
    if (!client) {
        const WebTorrent = await import('webtorrent');
        client = new WebTorrent.default();
    }

    return new Promise((resolve, reject) => {
        client.add(infoHash, { store: false }, (torrent) => {
            // Setelah mendapatkan info, hapus torrent dari client
            client.remove(torrent);

            // Ambil nama file terbesar (biasanya file utama)
            const mainFile = torrent.files.reduce((a, b) => a.length > b.length ? a : b);
            const torrentInfo = {
                name: torrent.name,
                fileName: mainFile.name,
                size: torrent.length,
                files: torrent.files.map(f => f.name)
            };

            resolve(torrentInfo);
        });
    });
}

// Fungsi untuk membersihkan judul
function cleanTitle(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Fungsi untuk mencari torrent berdasarkan judul yang mirip
async function findTorrentBySimilarTitle(title) {
    const cleanSearchTitle = cleanTitle(title);

    // Ambil semua torrent yang completed
    const torrents = await Torrent.find({ completed: true });

    // Hitung similarity score untuk setiap torrent
    const torrentsWithScore = torrents.map(torrent => ({
        torrent,
        score: Math.max(
            stringSimilarity.compareTwoStrings(cleanSearchTitle, cleanTitle(torrent.name)),
            stringSimilarity.compareTwoStrings(cleanSearchTitle, cleanTitle(torrent.fileName))
        )
    }));

    // Urutkan berdasarkan score tertinggi
    torrentsWithScore.sort((a, b) => b.score - a.score);

    // Ambil torrent dengan score di atas threshold
    const threshold = 0.6;
    return torrentsWithScore
        .filter(item => item.score >= threshold)
        .map(item => item.torrent);
}

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

        let torrent = null;

        // Cari berdasarkan infoHash di database
        torrent = await Torrent.findOne({
            infoHash: link.toLocaleLowerCase(),
            completed: true
        });

        // Jika tidak ditemukan di database, coba dapatkan info dari WebTorrent
        if (!torrent) {
            try {
                const torrentInfo = await getTorrentInfo(link);
                console.log('Torrent info from WebTorrent:', torrentInfo);

                // Cari torrent yang mirip di database
                const similarTorrents = await findTorrentBySimilarTitle(torrentInfo.name);
                if (similarTorrents.length > 0) {
                    torrent = similarTorrents[0];
                    console.log(`Found similar torrent: ${torrent.name}`);
                }
            } catch (error) {
                console.error('Error getting torrent info:', error);
            }
        }

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