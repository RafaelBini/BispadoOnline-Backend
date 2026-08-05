const { Pool } = require('pg');
require('dotenv-safe').config();

const pool = new Pool({
    connectionString: process.env.POSTGRES_CONN_STR
});

var db;
pool.connect().then(result => {
    db = result
    console.log('connected to db')

})
    .catch(ex => {
        console.log('Falha ao tentar conectar com o banco de dados', ex)
    })


function getPlaceHolders(total) {
    arr = []
    for (i = 1; i <= total; i++) arr.push(`$${i}`)
    return arr.join(',');
}


function camelObjectToSnake(obj) {
    const snakeObj = {};
    for (let key in obj) {
        const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        snakeObj[snakeKey] = obj[key];
    }
    return snakeObj;
}


function snakeObjectToCamel(obj) {
    const camelObj = {};
    for (let key in obj) {
        const camelKey = key.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
        camelObj[camelKey] = obj[key];
    }
    return camelObj;
}

function getSanitized(str) {
    return str.replace(/;/g, '--')
}

const add = async (tableName, obj, userId) => {
    tableName = getSanitized(tableName);
    obj.userId = userId;
    if (!obj.id) delete obj.id;
    obj = camelObjectToSnake(obj);
    const entries = Object.entries(obj);
    const values = entries.map(e => e[1])
    const columns = entries.map(e => e[0])
    const placeHolders = getPlaceHolders(values.length)
    return (await db.query(`INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeHolders}) RETURNING id;`, values)).rows[0].id
}

const get = async (tableName, id, userId) => {
    tableName = getSanitized(tableName);
    const result = await db.query(`SELECT * FROM ${tableName} WHERE id = $1 AND user_id='${userId}';`, [id])
    return result.rows.map(r => {
        return snakeObjectToCamel(r)
    })[0];
}

const del = async (tableName, id, userId) => {
    tableName = getSanitized(tableName);
    await db.query(`DELETE FROM ${tableName} WHERE id = $1 AND user_id='${userId}';`, [id])
    return;
}


const update = async (tableName, obj, userId) => {
    tableName = getSanitized(tableName);
    obj = camelObjectToSnake(obj);
    const entries = Object.entries(obj);
    const nodes = entries.map((e, index) => `${e[0]} = $${index + 1}`)
    const values = entries.map(e => e[1])
    var q = `UPDATE ${tableName} SET ${nodes.join(', ')} WHERE user_id='${userId}' AND id='${obj.id}';`;
    //console.log(q);
    return await db.query(q, values)
}

const MEMBERS_UPSERT_CHUNK = 100;

const bulkUpsertMembers = async (members, userId) => {
    if (!members.length) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        for (let offset = 0; offset < members.length; offset += MEMBERS_UPSERT_CHUNK) {
            const chunk = members.slice(offset, offset + MEMBERS_UPSERT_CHUNK);
            const values = [];
            const rowPlaceholders = [];
            let param = 1;

            for (const member of chunk) {
                rowPlaceholders.push(
                    `($${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++})`
                );
                values.push(
                    member.id,
                    member.legacyId ?? null,
                    member.name,
                    member.sex ?? null,
                    member.birth ?? null,
                    userId,
                    member.archived ?? false
                );
            }

            await client.query(
                `INSERT INTO members (id, legacy_id, name, sex, birth, user_id, archived)
                 VALUES ${rowPlaceholders.join(', ')}
                 ON CONFLICT (id) DO UPDATE SET
                   legacy_id = EXCLUDED.legacy_id,
                   name = EXCLUDED.name,
                   sex = EXCLUDED.sex,
                   birth = COALESCE(EXCLUDED.birth, members.birth),
                   archived = EXCLUDED.archived,
                   user_id = EXCLUDED.user_id`,
                values
            );
        }

        await client.query('COMMIT');
    } catch (ex) {
        await client.query('ROLLBACK');
        throw ex;
    } finally {
        client.release();
    }
};

module.exports = {
    add,
    get,
    del,
    update,
    bulkUpsertMembers,
    set: async (tableName, obj, userId) => {

        if (!obj.id) {
            await add(tableName, obj, userId)
            return;
        }
        //console.log(obj)
        var existentObj = await get(tableName, obj.id, userId)

        if (existentObj) {
            await update(tableName, obj, userId)
            return;
        }

        await add(tableName, obj, userId)
    },
    fetch: async (tableName, whereStr, userId) => {
        tableName = getSanitized(tableName);
        whereStr = getSanitized(whereStr);

        if (!whereStr) {
            whereStr = 'true=true'
        }

        const result = await db.query(`SELECT * FROM ${tableName} WHERE user_id='${userId}' AND ${whereStr};`)
        return result.rows.map(r => {
            return snakeObjectToCamel(r)
        });
    },
    count: async (tableName, whereStr, userId) => {
        tableName = getSanitized(tableName);
        whereStr = getSanitized(whereStr);

        if (!whereStr) {
            whereStr = 'true=true'
        }

        const result = await db.query(`SELECT COUNT(id) as count FROM ${tableName} WHERE user_id='${userId}' AND ${whereStr};`)
        return +result.rows[0].count
    },
    max: async (tableName, columnName, whereStr, userId) => {
        tableName = getSanitized(tableName);
        whereStr = getSanitized(whereStr);

        if (!whereStr) {
            whereStr = 'true=true'
        }

        const result = await db.query(`SELECT MAX("${columnName}") as max FROM ${tableName} WHERE user_id='${userId}' AND ${whereStr};`)
        return +result.rows[0].max
    },
    deleteWhere: async (tableName, whereStr, userId) => {
        tableName = getSanitized(tableName);
        whereStr = getSanitized(whereStr);

        if (!whereStr) {
            whereStr = 'true=true'
        }

        await db.query(`DELETE FROM ${tableName} WHERE user_id='${userId}' AND ${whereStr};`)
        return;
    }
}